# mc-gateway 数据库设计（选型 / 审计 / 向量）

> 千灯纪玩家门户服务端的数据层。目标：**人多了数据不乱、经得起审计、法术向量检索必须可用**。
> 本文是选型与 schema 的权威说明；SQL 落地在 `migrations/`，代码仓库适配层在 `mc_gateway.py`。

## 一、选型结论（为什么是 PostgreSQL 18 + pgvector 0.8.6）

**结论：门户主库用 PostgreSQL 18（装 pgvector 0.8.6 扩展 + pg_audit），SQLite 仅作嵌入式零依赖兜底/开发库。**（详尽的竞品核实见「第八节 备选数据库调研」）

| 需求 | SQLite（现状） | PostgreSQL + pgvector | 专用向量库 (Qdrant/Milvus) |
|---|---|---|---|
| 多人并发写入（人多了） | 单写者，写锁全局，多连接并发易 `database is locked` | 多写者并发、行级锁、成熟连接池 | —（非关系库） |
| 关系完整性（数据不乱） | 弱约束，FK 默认关 | 强实现：FK/UNIQUE/CHECK 全开 | 弱 / 无 |
| **经得起审计** | 只能自建 audit 表，缺语句级审计 | `pg_audit` 扩展（DDL/DML/角色）+ 自建不可改 audit_log | 无 |
| **向量检索（法术依赖 AI）** | 无原生 ANN，需 `sqlite-vec`/FTS（弱） | **`pgvector`：原生 `vector(n)` + HNSW 索引**，事务内 `<=>` 检索 | 最优但多一套服务 + 网络跳 |
| 运维成本 | 零（嵌入式） | 需装 Postgres 服务（Windows 安装/容器/远程） | 再起一个服务 |
| 数据规模上限 | 中小规模够用 | 千万级向量 <10ms（HNSW） | 亿级 |

**为什么必须上 PG+pgvector：** 门户要支持「玩家咏唱/自然语言 → 语义匹配法术」，这是典型 ANN 向量检索（每个玩家学习 N 个法术、每句 chant 都要 top-k 召回）。SQLite 无原生 ANN，硬造向量只能存 JSON 全表扫描，人一多就崩。pgvector 把向量列和审计、关系、事务放进**同一个 ACID 库**——法术的「学会」和它的「向量」能原子提交，审计覆盖一切，一致性有保证。规模（<50M 向量）pyvector HNSW 完全够，无需专用向量库。

**PG+pgvector 的 2026 现状**（已核实）：`vector(n)` 类型 + `<=>`(cos) / `<->`(L2) / `<#>`(内积) 相似度算符；**HNSW 默认索引**（建表前可建、读多写少快、m=16/ef_construction=64 均衡），查询 `SET hnsw.ef_search`；0.7+ 支持 `halfvec` 量化 + 并行 HNSW 构建。`ORDER BY embedding <=> $1` 触发索引扫描（`EXPLAIN` 看到 Index Scan 才吃索引）。

## 二、领域分组（高内聚）

按业务域分组，表之间用 FK 严格约束，杜绝脏数据。

### A. 身份与认证
- `users`（账号主表）
- `roles` + `users.role_id`（角色/权限，可审计的授权）
- `sessions`（Bearer token **哈希** 存库，含 ip/user_agent/revoked_at）
- `device_bindings`（可选机器绑定：machine_key 哈希 + 平台）
- `login_attempts`（登录尝试审计：成功/失败/原因/ip）

### B. 用户数据
- `profiles`（user_id PK，display_name/bio/preferences **jsonb**）
- `skins`（皮肤历史：texture_url/model/sha256/is_active——可审计的换肤记录）
- `characters`（玩家角色：name/class/stats jsonb/is_active）

### C. 法术 / AI 向量域（门户侧）
- `spells`（法术目录：key/name/category/description/chant/tier/rarity/is_public）
- `user_spells`（用户已习得：UNIQUE(user_id,spell_id)，source/proficiency）
- `spell_embeddings`（**向量表**：spell_id+model 唯一，embedding `vector(DIM)` + HNSW 索引）
- `chant_log`（**咏唱审计**：raw_text/matched_spell_id/method(exact|vector|llm)/confidence/consumed_mana/outcome）

### D. 审计（跨域，横向）
- `audit_log`（**只增不改**：actor/ip/action/object_type/object_id/old_json/new_json/reason/request_id；触发器禁止 UPDATE/DELETE；按日分月分区）

### E. 迁移
- `schema_migrations`（version/name/applied_at/applied_by/checksum/duration_ms——迁移本身可审计、可回滚到版本）

## 三、完整 schema（PostgreSQL + pgvector）

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A 身份
CREATE TABLE roles(
  id SMALLSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,          -- owner/admin/member/guest
  perms JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE users(
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,24}$'),
  password_hash TEXT NOT NULL,
  nickname TEXT,
  avatar TEXT,
  role_id SMALLINT NOT NULL DEFAULT 3 REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active',   -- active/banned/locked
  server_tag INTEGER DEFAULT 0,
  mc_uuid UUID,                       -- 关联的 Minecraft 账号（国际化）
  email TEXT, verified_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);
CREATE INDEX ON users(role_id);
CREATE TABLE sessions(
  token_hash TEXT PRIMARY KEY,        -- sha256(token)，不存明文
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip INET, user_agent TEXT,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX ON sessions(user_id);
CREATE TABLE device_bindings(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  machine_key_hash TEXT NOT NULL,
  platform TEXT,
  bound_at TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ, is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, machine_key_hash)
);
CREATE TABLE login_attempts(
  id BIGSERIAL PRIMARY KEY,
  username TEXT, ip INET, success BOOLEAN,
  reason TEXT, at TIMESTAMPTZ DEFAULT now()
);

-- B 用户数据
CREATE TABLE profiles(
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT, bio TEXT,
  preferences JSONB NOT NULL DEFAULT '{}',
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE skins(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  texture_url TEXT, model TEXT DEFAULT 'classic',
  sha256 TEXT, is_active BOOLEAN DEFAULT false,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE characters(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT, class TEXT, stats JSONB DEFAULT '{}',
  mc_username TEXT,               -- 游戏内登录名（ASCII），锚定账号↔角色的键
  is_active BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now()
);
-- 账号↔伴侣（一对一）：每个真人玩家一个私有无实体观察者 AI agent
CREATE TABLE companions(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  cname TEXT, personality JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- C 法术/AI 向量
CREATE TABLE spells(
  id BIGSERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,           -- e.g. 'home'/'heal'/'light'
  name TEXT NOT NULL, category TEXT,
  description TEXT, chant TEXT, tier TEXT, rarity TEXT,
  is_public BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE user_spells(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  spell_id BIGINT REFERENCES spells(id) ON DELETE CASCADE,
  learned_at TIMESTAMPTZ DEFAULT now(),
  source TEXT,                        -- skillbook/chant/quest/gift
  proficiency SMALLINT DEFAULT 1, is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, spell_id)
);
CREATE TABLE spell_embeddings(
  id BIGSERIAL PRIMARY KEY,
  spell_id BIGINT REFERENCES spells(id) ON DELETE CASCADE,
  model TEXT NOT NULL,                -- e.g. 'bge-m3'
  dim INT NOT NULL,
  embedding vector(1024) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(spell_id, model)
);
CREATE INDEX ON spell_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE TABLE chant_log(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  session_id TEXT, raw_text TEXT,
  matched_spell_id BIGINT REFERENCES spells(id),
  method TEXT,                        -- exact|vector|llm|reject
  confidence REAL, consumed_mana INT,
  outcome TEXT, at TIMESTAMPTZ DEFAULT now()
);

-- D 审计（只增不改）
CREATE TABLE audit_log(
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type TEXT,                    -- user/system/gateway/admin
  actor_id BIGINT, actor_name TEXT,
  ip INET,
  action TEXT NOT NULL,               -- create/update/delete/login/logout/grant/revoke/cast/download/...
  object_type TEXT, object_id TEXT,
  old_data JSONB, new_data JSONB,
  reason TEXT, request_id TEXT
);
-- 触发器禁止篡改审计日志（只增不改）
CREATE OR REPLACE FUNCTION forbid_audit_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
CREATE INDEX ON audit_log(at);
CREATE INDEX ON audit_log(object_type, object_id);
CREATE INDEX ON audit_log(actor_id);

-- 迁移记录
CREATE TABLE schema_migrations(
  version INT PRIMARY KEY, name TEXT, applied_at TIMESTAMPTZ DEFAULT now(),
  applied_by TEXT, checksum TEXT, duration_ms INT
);
```

## 四、审计设计（经得起审计）

**双轨审计**：
1. **业务层（细粒度、含语义）**：所有写操作经仓库层 `rep.write(conn, ...)` 在**同一事务**里写 `audit_log`，记录 `actor/ip/action/object_type/object_id/old_data/new_data/reason/request_id`。`audit_log` 是**只增不改**（触发器禁 UPDATE/DELETE），按月分区 + 索引；只授予**只读** auditor 角色，普通用户无 SELECT。
2. **数据库层（粗粒度、防绕过）**：`pg_audit` 扩展做 DDL/DML/角色语句审计；只对 `auth_auditor` 角色聚焦（`pgaudit.role`），避免日志洪泛。
   ```sql
   CREATE EXTENSION pgaudit;
   CREATE ROLE auth_auditor NOINHERIT;
   GRANT SELECT, DELETE ON auth.users TO auth_auditor;   -- 观察目标表
   ALTER ROLE postgres SET pgaudit.role TO 'auth_auditor';
   ALTER SYSTEM SET pgaudit.log = 'ddl, write, read';
   ```
- 关键：**权限分离**（应用连接 vs 审计连接：应用走可写、审计只读）、**保留策略**（audit 按 N 月清理/归档到冷存）、**登录/登出/注册/授权/改密/换肤/咏唱/下载 mod** 都注定写审计。

## 五、向量检索设计（法术强依赖 AI）

- **嵌入模型**：与 AI 侧一致用 `bge-m3`（1024 维，本地 ollama :11434 已有），维度由 `EMBEDDING_DIM` 配置（默认 1024），**必须与生成本法术向量的模型一致**。
- **索引**：`spell_embeddings.embedding vector(1024)` + HNSW（`vector_cosine_ops`，m=16/ef_construction=64）；查询 `SET hnsw.ef_search=60`，`ORDER BY embedding <=> :q LIMIT k`。
- **得分**：cosine 相似度 = `1 - distance`；门槛（如 ≥0.8 直接施法 / 0.5~0.8 走 LLM / <0.5 拒绝）沿用守则阈值。
- **混合检索（可选进阶）**：向量 + BM25（`tsvector`）加权，兼顾语义与关键词。
- **检索用例**：玩家自然语言咏唱 → 该表 top-k → 命中法术代施；按已学法术推荐技能书；查询 `user_spells` 展示技能树。
- **与 AI/世界侧分离（低耦合）**：世界进程 `mc-magic.ts` 的模糊施法用的世界的向量库（qdrant，别处），**门户用的是自己库里的 `spell_embeddings`**——两个域，互不写入，只通过 `spell.key` 对齐。这也符合早前「门户不打扰 AI」的铁律。

## 六、迁移路径（从现有 SQLite 上线）

1. **现库**：`<MC_DATA_DIR>/gateway/gateway.db`（3 张旧表）。迁移脚本 `migrate.py`：
   - 读旧 `users/sessions/world_players` → 映射进新规范化 schema（FK/role/status 补默认），**清掉 dev 测试账号**（kangqiang/probe_shan/e2e_p*）。
   - 建 `schema_migrations` 并记录版本 1；之后所有 schema 变更走 `migrations/NNNN_*.sql`（有序、幂等、可审计）。
2. **运行模式**：`GATEWAY_DB=sqlite`（默认，零依赖，现在的嵌入式库，规范化 schema，无 HNSW/向量索引——向量表存 JSON，向量检索仅在全表小规模可用）；`GATEWAY_DB=postgres` + `GATEWAY_DB_URL=postgresql://...`（上 pgvector，完整审计 + HNSW 向量检索）。
3. **建议**：人一多 / 向量检索成主路径时切到 PG。切 PG 是一次**基础设施变更**，需造物主点头后部署（先在测试端口验证再切生产）。

## 七、一致性 / 性能

- 所有写操作单事务（开 `BEGIN`→`COMMIT`），审计随业务同事务——**数据与审计永远一致**。
- 关键唯一键（username / token_hash / user_spell / spell_key）+ CHECK 约束兜底。
- 热点查询（online / profile / user_spells）加复合索引；`world_players` 这类在线快照属**缓存**，独立表、短 TTL，不作为权威源。

## 八、备选数据库调研（2026-08 核实结论，确认 PG 仍是优选）

> 造物主要求「再好好查查有没有更好的数据库」。硬查 2026 现状后结论：**没有比 PG+pgvector 更适合本需求的**；但两处值得知晓，其中一处是**淘汰项**。

### 关键事实（都有出处，非拍脑袋）
- **PostgreSQL**：当前 18.6 / 19 Beta3（2026-08-13 发布）。**pgvector 已到 0.8.6**（2026-07-29），新增 **HNSW 并行索引构建**、PG18 下 HNSW 性能提升、`halfvec` 量化、迭代索引扫描（防 overfilter）。0.8.x 连续修复 HNSW/IVFFlat 的 CVE 与内存泄漏（0.8.2 修了 CVE-2026-3172 缓冲区溢出）——**活跃维护、安全可靠**，是生产级首选。
- **sqlite-vec**：单文件、零网络跳、进程内 KNN、二进制量化+汉明距离（≈25× 快、>95% 准确）。**省掉一台服务**。但：无 HNSW（主要余弦/暴力），并发写/审计弱；要并发写+托管需 **Turso(libSQL)**。
- **DuckDB + `vss`（HNSW）**：**官方扩展**、基于 usearch、top-k 优化 ~66× 提速、能匹配 `1-array_cosine_similarity` 走索引。**但它是实验性**（官方明示勿生产）、**单写者嵌入式分析库**——不是多用户认证的 OLTP 服务器。**专治「很多数据的查询/报表/看板」**。
- **MySQL 9 / MariaDB**：MySQL 9 有 `VECTOR` 列但向量索引/审计弱（审计仅 Enterprise）；**MariaDB 有多项审计前缀 `--`/`#` 绕过漏洞（CVE-2026-3494）——直接淘汰**，不符合「经得起审计」。

### 对比结论
| 方案 | 关系完整性 | **审计** | **向量(HNSW)** | 多人并发写 | 运维 | 评级 |
|---|---|---|---|---|---|---|
| **PostgreSQL 18 + pgvector 0.8.6** | ★★★★★ | ★★★★★(pg_audit，无已知绕过) | ★★★★★(HNSW并行构建) | ★★★★★ | 需装一个服务 | **主库推荐** |
| SQLite + sqlite-vec (+Turso) | ★★★☆ | ★★☆(自建表) | ★★★☆(无HNSW/需Turso) | ★★★(单写者) | 零(嵌入式) | 兜底/极简 |
| DuckDB + vss | ★★(非OLTP) | ★☆☆ | ★★★☆(HNSW但实验) | ★(单写者) | 嵌入式 | **仅作分析/读模型** |
| MySQL 9 / MariaDB | ★★★★ | ★★(MariaDB 被 CVE 淘汰) | ★★★(MySQL支持弱) | ★★★★ | 一个服务 | ❌ 不选 |

### 最终建议（比第一版更明确）
1. **主库：PostgreSQL 18 + pgvector 0.8.6 + pg_audit**。证据最硬：关系+审计+向量三者在一库、HNSW 并行构建、审计无绕过、活跃维护。**仍是最优选。**
2. **可选加分项（针对「很多数据的查询」）**：把**只读的分析/看板**查询镜像到 **DuckDB(vss)**——它是 2026 最符合「快速跑大查询/报表」的引擎，作为**只读读模型**（periodic sync from PG/事件日志），**不承担认证写**、不与 AI 耦合。要的话我另做这层。
3. **唯一『省掉服务』的替代**：若造物主不想装 Postgres 服务，改走 **SQLite + sqlite-vec**（+Turso 若要多用户并发写），用同一套规范化 schema——但审计只靠自建表、向量无 HNSW，属降级方案。

**请拍板两点**：① 主库是否切 **PostgreSQL 18 + pgvector**（我先在测试端口部署验证）；② 是否加 **DuckDB 只读分析层**（专治大数据量查询/看板）。
