import gzip
import importlib.util
import io
from pathlib import Path
import uuid
import zlib

import nbtlib as n
import pytest

spec=importlib.util.spec_from_file_location("migrate_body",Path(__file__).with_name("migrate_body.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
MAID="10000000-0000-0000-0000-000000000011";OWNER="20000000-0000-0000-0000-000000000021"

def uid(value):
    raw=uuid.UUID(value).bytes
    return n.IntArray([int.from_bytes(raw[i:i+4],"big",signed=True)for i in range(0,16,4)])

def fixture():
    sword=n.Compound({"id":n.String("minecraft:diamond_sword"),"count":n.Int(1),"components":n.Compound({"minecraft:damage":n.Int(12),"minecraft:custom_name":n.String('"Original sword"')})})
    return n.Compound({"id":n.String("touhou_little_maid:maid"),"UUID":uid(MAID),"Owner":uid(OWNER),"Health":n.Float(23),
        "Pos":n.List[n.Double]([4.5,80,5.5]),"Rotation":n.List[n.Float]([45,0]),"HandItems":n.List[n.Compound]([sword,n.Compound()]),
        "ArmorItems":n.List[n.Compound]([n.Compound(),n.Compound(),n.Compound({"id":n.String("minecraft:iron_chestplate"),"count":n.Int(1)}),n.Compound()]),
        "MaidInventory":n.Compound({"Items":n.List[n.Compound]([n.Compound({"Slot":n.Int(7),"id":n.String("minecraft:arrow"),"count":n.Int(32)})])}),
        "attributes":n.List[n.Compound]([n.Compound({"id":n.String("minecraft:generic.max_health"),"base":n.Double(30)})]),"YsmModelId":n.String("qd_hub_kirito")})

def region(entities):
    data=zlib.compress(m.encoded(n.Compound({"DataVersion":n.Int(3955),"Position":n.IntArray([0,0]),"Entities":n.List[n.Compound](entities)})))
    record=(len(data)+1).to_bytes(4,"big")+b'\x02'+data;count=(len(record)+4095)//4096
    header=bytearray(8192);header[:4]=(2).to_bytes(3,"big")+bytes([count])
    return bytes(header)+record+bytes(count*4096-len(record))

def test_original_identity_inventory_components_and_health():
    source=fixture();data,report=m.player_data(source,OWNER,"minecraft:overworld",3955)
    player=n.File.parse(io.BytesIO(gzip.decompress(data)))
    assert m.identity(player['UUID'])==MAID and player['Health']==23 and player['attributes'][0]['base']==30
    assert m.counts(m.items_in_maid(source))==m.counts(player['Inventory']+player['EnderItems'])
    assert report['items']==34 and player['Inventory'][0]['components']['minecraft:damage']==12
    assert 'NumenOwner'not in player and 'MaidHistoryChat'not in player

def test_region_removes_only_original_entity_and_keeps_neighbor():
    neighbor=n.Compound({'id':n.String('minecraft:cow'),'UUID':uid('30000000-0000-0000-0000-000000000031'),'Health':n.Float(10)})
    old=region([fixture(),neighbor]);new,source=m.remove_entity(old,MAID)
    rows=list(m.chunks(new));assert len(rows)==1 and rows[0][1]['Entities']==[neighbor]
    assert new[8192:len(old)]==old[8192:] and m.identity(source['UUID'])==MAID

@pytest.mark.parametrize('change,reason',[
    (lambda e:e.__setitem__('Health',n.Float(0)),'life'),
    (lambda e:e.__setitem__('Owner',uid('30000000-0000-0000-0000-000000000031')),'owner'),
    (lambda e:e.__setitem__('MaidBackpackData',n.Compound({'unknown':n.Int(1)})),'opaque'),
])
def test_uncertain_original_refused(change,reason):
    entity=fixture();change(entity)
    with pytest.raises(ValueError,match=reason):m.player_data(entity,OWNER,'minecraft:overworld',3955)

def test_duplicate_and_mounted_original_refused():
    with pytest.raises(ValueError,match='not_unique'):m.remove_entity(region([fixture(),fixture()]),MAID)
    boat=n.Compound({'id':n.String('minecraft:boat'),'Passengers':n.List[n.Compound]([fixture()])})
    with pytest.raises(ValueError,match='dismount'):m.remove_entity(region([boat]),MAID)

def prepare(tmp_path):
    server=tmp_path/'server';(server/'world/entities').mkdir(parents=True)
    (server/'world/entities/r.0.0.mca').write_bytes(region([fixture()]))
    out=tmp_path/'rollback';m.prepare(server,'world/entities','world',MAID,OWNER,'minecraft:overworld',out,63999)
    return server,out

def test_cold_transaction_and_repeat_never_duplicate(tmp_path):
    server,out=prepare(tmp_path);result=m.apply(out)
    assert result['state']=='cold_applied_pending_original_identity_admission'
    assert (server/f'world/playerdata/{MAID}.dat').exists()
    assert list(m.chunks((server/'world/entities/r.0.0.mca').read_bytes()))[0][1]['Entities']==[]
    with pytest.raises(ValueError,match='already_started'):m.apply(out)

def test_changed_world_refuses_without_player_write(tmp_path):
    server,out=prepare(tmp_path);(server/'world/entities/r.0.0.mca').write_bytes(region([fixture(),fixture()]))
    with pytest.raises(ValueError,match='preimage'):m.apply(out)
    assert not(server/f'world/playerdata/{MAID}.dat').exists()

def test_interrupted_commit_requires_original_plan_reconciliation(tmp_path,monkeypatch):
    server,out=prepare(tmp_path);replace=m.os.replace;calls=[]
    def failing(src,dst):
        calls.append(dst)
        if len(calls)==2:raise OSError('simulated disk failure')
        return replace(src,dst)
    monkeypatch.setattr(m.os,'replace',failing)
    with pytest.raises(OSError):m.apply(out)
    assert m.json.loads((out/'migration.json').read_bytes())['state']=='applying_do_not_start_server'
    assert (out/'region.before').exists()and(out/'maid.before.nbt').exists()
    with pytest.raises(ValueError,match='already_started'):m.apply(out)


def test_duplicate_in_other_world_blocks_apply(tmp_path):
    server,out=prepare(tmp_path)
    other=server/'aincrad';(other/'entities').mkdir(parents=True)
    (other/'level.dat').write_bytes(b'world marker')
    (other/'entities/r.0.0.mca').write_bytes(region([fixture()]))
    with pytest.raises(ValueError,match='identity_changed'):m.apply(out)
    assert not(server/f'world/playerdata/{MAID}.dat').exists()


def test_item_components_order_does_not_change_identity():
    first=n.Compound({'id':n.String('minecraft:stone'),'count':n.Int(3),'components':n.Compound({'b':n.Int(1),'a':n.Int(2)})})
    second=n.Compound({'components':n.Compound({'a':n.Int(2),'b':n.Int(1)}),'count':n.Int(3),'id':n.String('minecraft:stone')})
    assert m.counts([first])==m.counts([second])
