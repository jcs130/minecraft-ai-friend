import { Button, Card, Field, Inline, Input, Page, PasswordInput, Select, Stack, Text, Textarea, useEffect, useRef, useState, useToast } from "@neko/plugin-ui"
import type { PluginSurfaceProps } from "@neko/plugin-ui"

type Resident = { id: string, characterId: string, name: string, bodyKind: string, state: string }
type State = { role?: string, localRoles?: string[], resident?: string, connected?: boolean, authorized?: boolean,
  uiToken?: string, waiting?: string, catalog?: { residents?: Resident[], availableBodies?: string[] } }

export default function ResidentPanel(props: PluginSurfaceProps<State>) {
  const state = props.state || {}
  const roles = state.localRoles || []
  const bodies = state.catalog?.availableBodies || []
  const residents = state.catalog?.residents || []
  const [mode, setMode] = useState("connect")
  const [role, setRole] = useState<string | null>(null)
  const [kind, setKind] = useState("")
  const [id, setId] = useState("")
  const [name, setName] = useState<string | null>(null)
  const [persona, setPersona] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const checking = useRef(false)
  const localRole = (role ?? state.role) || roles[0] || ""
  const selected = residents.find(row => row.id === id) || residents[0]
  const bodyKind = bodies.includes(kind) ? kind : bodies[0]
  const chosenName = name ?? localRole
  const toast = useToast()
  const label = (kind: string) => kind === "maid" ? "车万女仆" : "Numen"

  async function call(entry: string, args: Record<string, unknown>) {
    setBusy(true)
    try {
      await props.api.call(entry, { ...args, uiToken: state.uiToken })
      if (entry === "pair_resident") setCode("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      try { await props.api.refresh() } finally { setBusy(false) }
    }
  }

  useEffect(() => {
    if (!state.waiting || !state.authorized) return
    const timer = window.setInterval(async () => {
      if (checking.current) return
      checking.current = true
      try {
        await props.api.call("manage_residents", { op: "list", uiToken: state.uiToken })
      } catch {
        // Network interruptions can be retried while this panel is open.
      } finally {
        try { await props.api.refresh() } finally { checking.current = false }
      }
    }, 3000)
    return () => window.clearInterval(timer)
  }, [state.waiting, state.authorized, state.uiToken])

  return <Page title="千灯纪居民"><Stack>
    {state.connected ? <Text>已绑定 {state.role} → {state.resident}</Text> : null}
    <Card title="本机 N.E.K.O. 角色"><Stack>
      <Field required label="由哪个角色在游戏里行动">{roles.length ?
        <Select value={localRole} options={roles.map(value => ({ value, label: value }))} onChange={setRole} /> :
        <Input value={localRole} onChange={setRole} placeholder="本机角色名" />}
      </Field>
      <Inline>
        <Button disabled={!state.uiToken || busy} onClick={() => call("open_resident_website", { page: "characters" })}>打开 N.E.K.O. 角色管理</Button>
        <Button disabled={busy} onClick={() => props.api.refresh()}>刷新本机角色</Button>
      </Inline>
    </Stack></Card>
    {!state.authorized ? <Card title="登录千灯纪"><Stack>
      <Button disabled={!state.uiToken || busy} onClick={() => call("open_resident_website", { page: "authorize" })}>去官网授权</Button>
      <Field label="官网授权码" help="登录后复制官网显示的连接码。">
        <PasswordInput value={code} onChange={setCode} placeholder="XXXX-XXXX-XXXX" />
      </Field>
      <Button tone="primary" disabled={busy || !state.uiToken || !code.trim()}
        onClick={() => call("pair_resident", { code: code.trim(), localRole })}>验证连接码</Button>
    </Stack></Card> : <Card title="选择游戏角色"><Stack>
      <Inline>
        <Button tone={mode === "connect" ? "primary" : "default"} disabled={busy} onClick={() => { setMode("connect") }}>已有角色</Button>
        <Button tone={mode === "create" ? "primary" : "default"} disabled={busy} onClick={() => { setMode("create") }}>新建角色</Button>
      </Inline>
      {mode === "connect" ? (selected ? <Stack>
        <Field label="我的角色"><Select value={selected.id} onChange={setId} options={residents.map(row => ({
          value: row.id, label: row.name + " · " + label(row.bodyKind) + (row.state === "preparing" ? "（准备中）" : "")
        }))} /></Field>
        <Button disabled={busy || !!state.waiting || !localRole} onClick={() => call("manage_residents", {
          op: "connect", id: selected.id, characterId: selected.characterId, localRole
        })}>连接这个角色</Button>
      </Stack> : <Text>这个账号还没有游戏角色，可以新建一个。</Text>) : (bodyKind ? <Stack>
        <Field label="身体"><Select value={bodyKind} onChange={setKind} options={bodies.map(value => ({ value, label: label(value) }))} /></Field>
        <Field required label="游戏角色名"><Input value={chosenName} onChange={setName} /></Field>
        <Field label="游戏中的角色设定（可选）"><Textarea value={persona} onChange={setPersona} /></Field>
        <Button disabled={busy || !!state.waiting || !localRole || !chosenName.trim()} onClick={() => call("manage_residents", {
          op: "create", localRole, bodyKind, name: chosenName.trim(), persona
        })}>创建并连接</Button>
      </Stack> : <Text>服务器当前没有可用的新身体。</Text>)}
      {state.waiting ? <Text>正在准备 {state.waiting} 的游戏身体。保持面板打开就会自动连接。</Text> : null}
      <Button disabled={busy} onClick={() => call("manage_residents", { op: "list" })}>刷新游戏角色</Button>
    </Stack></Card>}
  </Stack></Page>
}
