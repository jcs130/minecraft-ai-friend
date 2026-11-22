import { Button, Card, Field, Inline, Input, Page, PasswordInput, Select, Stack, Text, Textarea, useEffect, useRef, useState, useToast } from "@neko/plugin-ui"
import type { PluginSurfaceProps } from "@neko/plugin-ui"

type Resident = { id: string, characterId: string, name: string, bodyKind: string, bodyId?: string, state: string }
type Body = {characterId: string, name: string, activeKind: string | null, status: string, pendingRequestId: string | null}
const bodyNames: Record<string, string> = {maid: "车万女仆", numen: "Numen", mineflayer: "Mineflayer 玩家", villager: "村民"}
const statuses: Record<string, string> = {ready:"可用", switching:"交接中", recovery_required:"待核实",
  completed:"已完成", blocked:"本次未执行"}
type State = { role?: string, localRoles?: string[], resident?: string, connected?: boolean, authorized?: boolean,
  deviceLogin?: boolean, deviceCode?: string, deviceUrl?: string, devicePlay?: boolean,
  deviceState?: {status?: string, account?: string, character?: Resident, modes?: string[], activeKind?: string,
    controller?: string, controllerName?: string, canStart?: boolean, pendingRequestId?: string, preferredMode?: string},
  bodyReadable?: boolean, bodyView?: {available: boolean, characters: Body[]},
  bodyReceipt?: {characterId: string, requestId: string, status: string},
  uiToken?: string, browserCode?: string, waiting?: string, catalog?: { residents?: Resident[], availableBodies?: string[] } }

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
  const [manual, setManual] = useState(false)
  const [playMode, setPlayMode] = useState("")
  const [busy, setBusy] = useState(false)
  const [characterId, setCharacterId] = useState("")
  const [receiptId, setReceiptId] = useState("")
  const bodyRows = state.bodyView?.characters || []
  const character = bodyRows.find(row => row.characterId === characterId) || bodyRows[0]
  const original = receiptId.trim() || character?.pendingRequestId || ""
  const checking = useRef(false)
  const localRole = (role ?? state.role) || roles[0] || ""
  const selected = residents.find(row => row.id === id) || residents[0]
  const bodyKind = bodies.includes(kind) ? kind : bodies[0]
  const chosenName = name ?? localRole
  const device = state.deviceState
  const deviceCharacter = device?.character
  const selectedMode = [playMode, device?.preferredMode, deviceCharacter?.bodyKind]
    .find(value => value && device?.modes?.includes(value)) || ""
  const modeNames: Record<string,string> = {maid:"车万女仆", numen:"玩家模式（Numen）", mineflayer:"玩家模式", villager:"村民"}
  const controlNames: Record<string,string> = {this_device:"本机", other_device:"另一台已授权设备",
    resident_plugin:"原居民插件", game_server:"服务器控制端"}
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
    const browser = state.browserCode && !state.authorized
    const deviceLogin = state.deviceLogin
    if (!browser && !deviceLogin && (!state.waiting || !state.authorized)) return
    const timer = window.setInterval(async () => {
      if (checking.current) return
      checking.current = true
      try {
        await props.api.call(deviceLogin ? "desktop_device" : browser ? "resident_browser_login" : "manage_residents", {
          op: deviceLogin ? "complete" : browser ? "status" : "list", uiToken: state.uiToken,
        })
      } catch {
        // Network interruptions can be retried while this panel is open.
      } finally {
        try { await props.api.refresh() } finally { checking.current = false }
      }
    }, 3000)
    return () => window.clearInterval(timer)
  }, [state.waiting, state.browserCode, state.authorized, state.deviceLogin, state.uiToken])

  useEffect(() => {
    if (!deviceCharacter || !state.uiToken) return
    function restore() {
      if (checking.current || document.visibilityState !== "visible") return
      checking.current = true
      void props.api.call("desktop_device", {op:"refresh",uiToken:state.uiToken})
        .then(() => props.api.refresh()).catch(() => {}).finally(() => { checking.current = false })
    }
    window.addEventListener("focus", restore)
    return () => window.removeEventListener("focus", restore)
  }, [deviceCharacter?.characterId, state.uiToken])

  return <Page title="千灯纪"><Stack>
    {state.deviceLogin && <Card title="等待设备授权"><Stack>
      <Text>{state.deviceCode ? `另一台设备授权时输入 ${state.deviceCode}` : "请在浏览器确认授权，然后返回 N.E.K.O.。"}</Text>
      {state.deviceUrl && <Field label="在另一台设备打开此地址"><Input value={state.deviceUrl} onChange={() => {}} /></Field>}
    </Stack></Card>}
    {deviceCharacter ? <Card title={deviceCharacter.name}><Stack>
      <Text>{device.account} · {deviceCharacter.bodyId}</Text>
      {device.modes?.length ? <Field label="使用身体"><Select value={selectedMode}
        options={device.modes.map(value => ({value, label:modeNames[value] || value}))} onChange={setPlayMode} /></Field> : null}
      {device.controller && <Text>当前控制端 · {controlNames[device.controller] || device.controller}{device.controllerName ? ` · ${device.controllerName}` : ""}</Text>}
      {device.pendingRequestId && <Text>原换身请求 · {device.pendingRequestId}</Text>}
      <Inline>
        {state.devicePlay ? <Button disabled={busy} onClick={() => call("desktop_device",{op:"stop"})}>停止游玩</Button>
          : <Button tone="primary" disabled={busy || !device.canStart || selectedMode !== deviceCharacter.bodyKind}
              onClick={() => call("desktop_device",{op:"start",mode:selectedMode,localRole})}>开始游玩</Button>}
        <Button disabled={busy} onClick={() => call("desktop_device",{op:"refresh"})}>刷新状态</Button>
        <Button disabled={busy} onClick={() => call("desktop_device",{op:"recovery",mode:selectedMode})}>
          {device.controller && !state.devicePlay ? "查看控制端与恢复入口"
            : selectedMode !== deviceCharacter.bodyKind && !state.devicePlay ? "在官网确认换身" : "在官网管理身体"}
        </Button>
      </Inline>
      <Inline>
        {!state.devicePlay && <Button disabled={busy || state.deviceLogin}
          onClick={() => call("desktop_device",{op:"login"})}>重新选择角色</Button>}
        <Button disabled={busy} onClick={() => call("desktop_device",{op:"manage"})}>管理设备</Button>
        <Button disabled={busy} onClick={() => call("desktop_device",{op:"unlink"})}>撤销本机授权</Button>
      </Inline>
    </Stack></Card> : <Card title="登录千灯纪"><Stack>
      {device?.status === "reauthorize" && <Text>设备授权已失效。重新登录后可继续使用原角色。</Text>}
      {device?.status === "unavailable" && <Text>暂未读到角色状态，可以刷新后重试。</Text>}
      <Button tone="primary" disabled={!state.uiToken || busy}
        onClick={() => call("desktop_device",{op:"login"})}>{device?.status ? "重新登录千灯纪" : "登录千灯纪"}</Button>
      <Inline>
        <Button disabled={!state.uiToken || busy} onClick={() => call("desktop_device",{op:"cross-device"})}>跨设备六位码</Button>
        {device?.status === "unavailable" && <Button disabled={busy} onClick={() => call("desktop_device",{op:"refresh"})}>重试读取角色</Button>}
        <Button disabled={busy} onClick={() => setManual(!manual)}>{manual ? "收起旧版连接" : "旧版连接"}</Button>
      </Inline>
    </Stack></Card>}
    {state.connected ? <Text>已绑定 {state.role} → {state.resident}</Text> : null}
    {manual && <Card title="角色身体与换身"><Stack>
      <Button disabled={busy || !state.uiToken} onClick={() => call("open_resident_website", {page:"bodies"})}>在官网管理身体</Button>
      {state.bodyReadable && <Stack>
        <Button disabled={busy} onClick={() => call("read_character_body", {op:"list"})}>查看身体状态</Button>
        {character ? <Stack>
          <Field label="我的角色"><Select value={character.characterId}
            options={bodyRows.map(row => ({value:row.characterId,label:row.name}))}
            onChange={value => { setCharacterId(value); setReceiptId("") }} /></Field>
          <Text>{bodyNames[character.activeKind || ""] || "身体待核实"} · {statuses[character.status] || "待核实"}</Text>
          <Field label="换身请求编号"><Input value={receiptId} placeholder={character.pendingRequestId || "填写原请求编号"} onChange={setReceiptId} /></Field>
          <Button disabled={busy || !original} onClick={() => call("read_character_body", {
            op:"receipt",characterId:character.characterId,requestId:original
          })}>查看原回执</Button>
          {state.bodyReceipt?.characterId === character.characterId && state.bodyReceipt.requestId === original &&
            <Text>{statuses[state.bodyReceipt.status] || "待核实"}</Text>}
        </Stack> : state.bodyView && <Text>{state.bodyView.available ? "当前账号还没有可管理身体的角色。" : "服务器尚未开放角色换身。"}</Text>}
      </Stack>}
    </Stack></Card>}
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
    {manual && (!state.authorized ? <Card title="旧版居民授权"><Stack>
      <Button tone="primary" disabled={!state.uiToken || busy} onClick={() => call("resident_browser_login", { op: "start" })}>
        {state.browserCode ? "重新打开授权页" : "在浏览器登录并授权"}
      </Button>
      {state.browserCode ? <Text>请在官网输入 {state.browserCode}。确认后，这里会自动显示游戏角色。</Text> : null}
      {manual ? <Stack>
        <Button disabled={!state.uiToken || busy} onClick={() => call("open_resident_website", { page: "authorize" })}>去官网获取授权码</Button>
        <Field label="官网授权码"><PasswordInput value={code} onChange={setCode} placeholder="XXXX-XXXX-XXXX" /></Field>
        <Button disabled={busy || !state.uiToken || !code.trim()}
          onClick={() => call("pair_resident", { code: code.trim(), localRole })}>验证授权码</Button>
      </Stack> : null}
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
    </Stack></Card>)}
  </Stack></Page>
}
