// Read-only architecture projection. Edges describe mechanisms, never inferred executions.
const NS = 'http://www.w3.org/2000/svg';
const node = (id, title, subtitle, x, y, tone, detail, record = null) => ({id, title, subtitle, x, y, tone, detail, record, w: 128, h: 68});
export function buildArchitectureGraph(mode = 'online', trace = null, rsi = null) {
  const graph = {mode, nodes: [], edges: [], lanes: [], width: 800, height: 390};
  const n = (...args) => graph.nodes.push(node(...args));
  const e = (from, to, label = '', route = null) => graph.edges.push({from, to, label, route, evidence: 'mechanism'});
  if (mode === 'online') {
    graph.lanes = [{x: 300, y: 40, w: 304, h: 113, tone: 'purple', title: 'SYSTEM 1  /  快反应'}, {x: 300, y: 205, w: 304, h: 113, tone: 'cyan', title: 'SYSTEM 2  /  慢规划'}];
    n('vision', '视觉 / 空间', '实体 · 方块 · 周边', 12, 52, 'blue', '对应具身架构的外部空间感知。现役 Agent 使用结构化世界观察；直播 3D 画面不是已证明输入模型的视觉流。');
    n('hearing', '听觉 / 交流', '文字来信 · 世界事件', 12, 155, 'blue', '以已送达的文字与世界事件类比听觉输入；此图不宣称麦克风、ASR 或原始音频已经接入。');
    n('body', '本体感知', '生命 · 饥饿 · 库存', 12, 258, 'blue', '身体状态来自当前公开快照，与下方历史决策回放分开。', trace?.agent || null);
    n('perception', '感知整合', '事件 / 状态 / 目标', 161, 155, 'blue', '将环境、交流与身体状态汇入在线控制。连线为架构机制，不代表保留了每个输入的处理日志。');
    n('jev', 'Jev 决策', '有限候选 · 置信门控', 310, 76, 'purple', 'System 1 的模型选择节点。Jev 是模型调用；不是每段脚本都要经过 Jev。实际候选概率、置信度和耗时见下方 Jev 分支。', trace?.systemOne || null);
    n('scripts', '脚本 / 技能', '已测程序 · 快速执行', 466, 76, 'purple', 'System 1 的程序执行节点。已验证脚本和原生动作可直接执行；不将这些调用算作 LLM 推理。');
    n('llm', 'LLM 决策', '目标理解 · 任务分解', 310, 241, 'cyan', 'System 2 处理规划、未知情况与升级请求。只展示可观察的决策摘要和调用，不补写未记录的内部推理。', trace?.routing || null);
    n('plan', '规划 / 调度', '计划 → 工具 / 子目标', 466, 241, 'cyan', '慢系统可调用工具或组织已有技能。低置信度转交是机制；未绑定的 Jev 和 LLM 历史轮次不会被拼成一条真实链。');
    n('control', '控制 / 工具', 'L0 · 原生身体执行', 649, 155, 'amber', '工具参数、执行状态和真实耗时由动作回执提供。L0 表示本项目展示的身体执行层，并不意味已实现逐帧模型控制。');
    n('feedback', '世界反馈', '回执 · 环境变化', 649, 295, 'blue', '动作回执与新观察重新进入感知。反馈回边显式绘出；单轮处理是 DAG，跨轮反馈构成闭环。');
    e('vision','perception'); e('hearing','perception'); e('body','perception');
    e('perception','jev'); e('perception','llm'); e('jev','scripts'); e('scripts','control'); e('llm','plan'); e('plan','control');
    e('perception','scripts','已知规则 → 程序直达', 'M 225 155 V 18 H 530 V 68');
    e('plan','scripts','技能复用', 'M 530 241 V 152');
    e('jev','llm','低置信 / 未知', 'M 374 144 V 232'); e('control','feedback');
    e('feedback','perception','反馈 → 下一轮感知', 'M 649 329 H 225 V 230');
    graph.caption = 'L0 / L1 在线回路 · 双系统协同；快慢描述职责，不承诺固定毫秒数';
  } else if (mode === 'l2') {
    graph.lanes = [{x: 15,y: 34,w: 766,h: 286,tone:'purple',title:'L2  /  经验层自我进化 · 保留框架，更新可复用经验'}];
    const skills = rsi?.l2?.localSkills || [], knowledge = rsi?.l2?.knowledge || [];
    n('episodes','行动经历','轨迹 · 成功与失败',35,85,'blue','真实行动及结果是学习材料。不同运行条件的样本不能直接作为改进前后的对照。',rsi?.l1?.behaviors || null);
    n('reflect','反思 / 归因','提炼条件与结果',228,85,'purple','从经历提出经验假设；模型的自我评价不等于独立验证。',rsi?.l1?.generation || null);
    n('dream','Dream / 演练','历史重放 · 候选策略',421,85,'purple','规划中的经验演练节点。当前观测 API 未提供 Dream 运行回执，状态待接入。Dream-RSI 的历史树策略重放与普通记忆整理不是同一机制。');
    n('memory','知识 / 经验库',rsi?.sources?.knowledge?`${knowledge.length} 份文件索引`:'索引待读取',228,229,'purple','只展示已有知识索引；文件数量不代表已验证的知识量。',rsi?.l2?.knowledge || null);
    n('skills','技能候选',rsi?.sources?.learning?`${skills.filter(s=>s.enabled).length} 项启用 · 非收益`:'技能待读取',421,229,'purple','区分草稿、启用和行为验证。启用一项技能不自动完成一次自我进化。',rsi?.l2 || null);
    n('verify','行为验证','场景测试 · 实际反馈',624,155,'amber','在适用场景核实效果，失败继续修订。跨任务收益仍需独立对照，不能只看模型判断。',rsi?.l2?.feedback || null);
    e('episodes','reflect'); e('reflect','dream'); e('reflect','memory'); e('dream','skills'); e('memory','skills'); e('skills','verify');
    e('verify','episodes','通过 → 在线复用；失败 → 修订', 'M 752 189 H 771 V 344 H 99 V 161');
    graph.caption = 'Dream 回执待接入 · 反思、知识、技能属于 L2；机制流光不代表正在执行';
  } else {
    graph.lanes = [{x:15,y:34,w:766,h:286,tone:'amber',title:'L3  /  框架层自我进化 · 开发与运营回路'}];
    n('proposal','改进提案','问题 · 基线 · 指标',35,90,'amber','提案需要明确基线、候选版本、要改善的指标和验证条件。工单关闭不代表能力提升。',rsi?.l3?.cases || null);
    n('candidate','修改候选','代码 / 流程 / 模型',228,90,'amber','可修改代码、工作流、节点、模型选择与工具/MCP。该分类是架构设计，不表示当前所有类型都已自动接通。',rsi?.l3?.plans || null);
    n('compile','编译 / 固定测试','构建 · 契约 · 回归',421,90,'amber','先通过原有固定测试。构建成功仅是候选准入，不是进化收益。',rsi?.l3?.receipts || null);
    n('evaluate','独立对照评测','同任务 · 同预算',624,90,'amber','冻结基线和评测协议，在保留任务对比成功率、成本、时延和回归。当前 API 没有完整的代际对照收益记录。');
    n('revise','退回 / 回滚','失败或不确定',228,235,'blue','编译失败、回归退化或收益不确定时保留旧版本，候选继续修订。');
    n('gate','真正变好？','收益证据：未知',421,235,'amber','只有独立评测确认改善、关键能力无不可接受回归，并完成部署验收，才计入完成进化。测试 ok、resolved 和新提交都不足以单独证明。',{verifiedImprovement:null});
    n('release','完成一次进化','验证后发布 · 留存版本',624,235,'purple','这是受验证门控的机制终点。当前没有完整的已验收收益链，不能显示“进化成功”或增加代数。');
    e('proposal','candidate'); e('candidate','compile'); e('compile','evaluate'); e('evaluate','gate'); e('gate','release','通过'); e('gate','revise','未通过');
    e('revise','candidate','重新提案', 'M 292 235 V 166');
    e('release','proposal','新版本 → 下一轮改进', 'M 688 303 V 344 H 99 V 166');
    graph.caption = '改动范围：代码 · 工作流 · 节点 · 模型 · 工具 / MCP ｜ 收益未证实，不计完成进化';
  }
  return graph;
}

function svgElement(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}
export function renderArchitectureGraph(svg, graph, onSelect) {
  const s = svgElement, map = new Map(graph.nodes.map(n => [n.id,n]));
  svg.replaceChildren(); svg.setAttribute('viewBox',`0 0 ${graph.width} ${graph.height}`);
  const defs=s('defs'), marker=s('marker',{id:'architecture-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:5,markerHeight:5,orient:'auto'});
  marker.append(s('path',{d:'M 0 1 L 9 5 L 0 9',fill:'none',stroke:'#68899e','stroke-width':1.5}));defs.append(marker);svg.append(defs);
  for(const lane of graph.lanes){svg.append(s('rect',{x:lane.x,y:lane.y,width:lane.w,height:lane.h,rx:15,class:`architecture-lane ${lane.tone}`}),s('text',{x:lane.x+13,y:lane.y+22,class:`architecture-label ${lane.tone}`},lane.title));}
  graph.edges.forEach((edge,index)=>{
    const a=map.get(edge.from),b=map.get(edge.to); let path=edge.route;
    if(!path){if(b.x>a.x){const ax=a.x+a.w,ay=a.y+a.h/2,bx=b.x-5,by=b.y+b.h/2;path=`M ${ax} ${ay} C ${(ax+bx)/2} ${ay} ${(ax+bx)/2} ${by} ${bx} ${by}`;}
    else if(b.x<a.x&&a.y===b.y)path=`M ${a.x} ${a.y+34} H ${b.x+b.w+5}`;
    else{const down=b.y>a.y,ax=a.x+64,ay=down?a.y+a.h:a.y,bx=b.x+64,by=down?b.y-5:b.y+b.h+5;path=`M ${ax} ${ay} C ${ax} ${(ay+by)/2} ${bx} ${(ay+by)/2} ${bx} ${by}`;}}
    const group=s('g',{class:'architecture-edge','data-mechanism':'true'});group.append(s('path',{d:path,class:'architecture-wire','marker-end':'url(#architecture-arrow)'}),s('path',{d:path,class:'architecture-signal'}));
    if(edge.label){let x,y;if(edge.from==='feedback'){x=412;y=350;}else if(edge.from==='perception'&&edge.to==='scripts'){x=400;y=13;}else if(edge.from==='plan'&&edge.to==='scripts'){x=565;y=197;}else if(edge.from==='jev'){x=421;y=197;}else if(edge.from==='verify'||edge.from==='release'){x=400;y=369;}else if(edge.from==='revise'){x=294;y=201;}else{x=(a.x+b.x+a.w)/2;y=a.y+23;}group.append(s('text',{x,y,'text-anchor':'middle',class:'architecture-edge-label'},edge.label));}svg.append(group);
  });
  for(const n of graph.nodes){const g=s('g',{class:`architecture-node ${n.tone}`,transform:`translate(${n.x} ${n.y})`,role:'button',tabindex:0,'data-architecture-node':n.id,'aria-label':`${n.title}：${n.subtitle}`,'aria-pressed':false});
    g.append(s('rect',{width:n.w,height:n.h,rx:10}),s('circle',{cx:13,cy:18,r:3}),s('text',{x:23,y:23,class:'architecture-title'},n.title),s('text',{x:12,y:49,class:'architecture-subtitle'},n.subtitle));
    const select=()=>{svg.querySelectorAll('[data-architecture-node]').forEach(other=>other.setAttribute('aria-pressed',String(other===g)));onSelect(n);};g.addEventListener('click',select);g.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});svg.append(g);
  }
}
