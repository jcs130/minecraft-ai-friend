import dataclasses

import pytest
from test_controller import packed, setup

from agent_mc_autonomy.configuration import Settings


def config(tmp_path):
    return {"backend":{"provider":"java-client"},"server":{"host":"fixture.test","username":"Test","version":"1.20.6","auth":"offline"},
            "java_client":{"expected_uuid":"12345678-1234-1234-1234-123456789abc","expected_server":"fixture.test:25565","controller_id":"independent-controller",
                           "credentials_file":str(tmp_path/"connection.json"),"ledger_dir":str(tmp_path/"stable-ledger")}}

def test_offline_real_client_configuration_and_rename_continuity(tmp_path):
    settings=Settings.parse(config(tmp_path))
    native=settings.client_config(tmp_path)
    assert native["world"]["provider"]=="java-client" and native["world"]["auth"]=="offline"
    assert native["dataDir"]==str(tmp_path/"stable-ledger")
    renamed=dataclasses.replace(settings,username="Renamed")
    assert renamed.identity==settings.identity and renamed.client_config(tmp_path)["dataDir"]==native["dataDir"]
    assert native["world"]["javaClient"]["expectedUuid"]==settings.java_client["expectedUuid"]

def test_no_implicit_java_credentials_or_second_viewer(tmp_path):
    raw=config(tmp_path)
    raw["java_client"]["expected_uuid"]=""
    with pytest.raises(ValueError,match="UUID"):
        Settings.parse(raw)
    raw=config(tmp_path)
    raw["viewer"]={"renderer_directory":"somewhere","catalog_file":"catalog"}
    with pytest.raises(ValueError,match="second Mineflayer"):
        Settings.parse(raw)

def test_controller_renews_real_client_lease_without_a_model_call(framework_module,tmp_path,run_async):
    _,bridge,controller=setup(framework_module,tmp_path,None)
    controller.settings=Settings.parse(config(tmp_path))
    controller.body_lease_due=0
    original=bridge.call
    async def call(name,args,**kwargs):
        if name=="mc_control":
            bridge.calls.append((name,args,kwargs))
            return packed({"expiresAt":15000})
        return await original(name,args,**kwargs)
    bridge.call=call
    run_async(controller.events())
    assert [args for name,args,_ in bridge.calls if name=="mc_control"]==[{"action":"renew","ttlMs":15000}]
    assert not any(name=="mc_do" for name,*_ in bridge.calls)

def test_native_startup_inspects_before_claim_without_creating_a_second_body_loop(framework_module,tmp_path,run_async):
    stopped=False
    _,bridge,controller=setup(framework_module,tmp_path,None,stop=lambda:stopped)
    controller.settings=Settings.parse(config(tmp_path))
    bridge.tools.extend({"name":name,"inputSchema":{"type":"object"}} for name in ("mc_capabilities","mc_operations","mc_control"))
    original=bridge.call
    async def call(name,args,**kwargs):
        nonlocal stopped
        if name in {"mc_capabilities","mc_operations","mc_control"}:
            bridge.calls.append((name,args,kwargs))
            if name=="mc_control":
                stopped=True
            return packed({"protocol":"agent-mc-java/v1"})
        return await original(name,args,**kwargs)
    bridge.call=call
    run_async(controller.run("inspect only"))
    names=[name for name,*_ in bridge.calls]
    assert names.index("mc_capabilities")<names.index("mc_operations")<names.index("mc_help")<names.index("mc_control")
    assert not any(name=="mc_do" for name in names) and bridge.closed

def test_old_body_build_is_rejected_before_any_connection(framework_module,tmp_path,run_async):
    _,bridge,controller=setup(framework_module,tmp_path,None)
    controller.settings=Settings.parse(config(tmp_path))
    with pytest.raises(RuntimeError,match="java_client_backend_required"):
        run_async(controller.run("inspect only"))
    assert not any(name=="mc_connection" and args["action"]=="connect" for name,args,_ in bridge.calls)
    assert bridge.closed

def test_native_tool_projection_keeps_operations_instead_of_mineflayer_steps():
    from agent_mc_autonomy.controller import model_tools
    catalog=[{"name":"mc_do","description":"Submit one discovered operation using action_id","inputSchema":{"type":"object","properties":{"operation":{"type":"string"},"input":{"type":"object"}}}}]
    catalog.extend({"name":name,"inputSchema":{"type":"object"}} for name in ("mc_control","mc_capabilities","mc_operations","mc_result","mc_wait","mc_cancel"))
    tools=model_tools(catalog)
    functions={tool["function"]["name"]:tool["function"] for tool in tools}
    assert "mc_control" not in functions and {"mc_capabilities","mc_operations","mc_result","mc_wait","mc_cancel"}<=functions.keys()
    assert "operation" in functions["mc_do"]["parameters"]["properties"]
    assert "flat step" not in functions["mc_do"]["description"] and "discovered operation" in functions["mc_do"]["description"]

@pytest.mark.parametrize("body",['{"health":5,"food":20}','{"health":20,"food":3}'])
def test_fast_rules_read_native_vitals_without_inference(body):
    from agent_mc_autonomy.context import RULES
    from agent_mc_autonomy.fast import rule_focus
    assert rule_focus({"facts":{"body":body}})=="survival"
    assert "Java protocol: 1.21.1" not in RULES
