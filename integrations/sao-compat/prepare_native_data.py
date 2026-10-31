"""Build-source upgrade on the exact current owned addon; never install or start.

Preserves premium/shared authentication, arrival, Numen and action-ledger source.
The candidate must additionally compare all unchanged class bytes with the baseline.
"""
from pathlib import Path
import argparse,hashlib,json,shutil

HERE=Path(__file__).resolve().parent
BASELINE_SHA='e7d5a98be3647732f3f706d3a9113bfc0cd95fe3d6f4f01699a6e3cce17e8f91'

def sha(p):
    with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def patch_native(text):
    def change(before,after):
        nonlocal text
        if text.count(before)!=1:raise ValueError('native_data_patch_anchor_changed: '+before[:100])
        text=text.replace(before,after)
    for expected in ['return SaoAuthentication.loggedIn(p);','out.add("authentication",SaoAuthentication.status(p));',
                     'error(out,"authentication_required","blocked");sendMenu(p,out);return;']:
        if text.count(expected)!=1:raise ValueError('current_authentication_binding_required')
    change('private static boolean recipeAvailable(){return false;}','private static boolean recipeAvailable(){return true;}')
    change('case "recipes" -> {error(out,"forge_recipe_adapter_not_yet_available","blocked");}', 'case "recipes" -> {SaoRecipes.query(p,args,out);}')
    change('row.addProperty("mayPickup",s.mayPickup(p));layout.add(row);','row.addProperty("mayPickup",s.mayPickup(p));MenuFacts.slot(p,m,s,row);layout.add(row);')
    change('out.addProperty("selectedHotbarSlot",p.getInventory().selected);','out.addProperty("selectedHotbarSlot",p.getInventory().selected);MenuFacts.menu(p,m,out);')
    change('p.closeContainer();','p.closeContainer();p.inventoryMenu.broadcastFullState();')
    return text

def prepare(baseline_build,baseline_jar,output):
    baseline_build=Path(baseline_build).resolve(strict=True);baseline_jar=Path(baseline_jar).resolve(strict=True);output=Path(output).resolve()
    if output.exists():raise ValueError('fresh_output_required')
    if sha(baseline_jar)!=BASELINE_SHA or sha(baseline_build/'build/libs/maw-sao-native-0.1.1.jar')!=BASELINE_SHA:raise ValueError('exact_current_addon_and_build_required')
    src=baseline_build/'src/main/java/dev/qiandeng/maw/saoforge';text=patch_native((src/'NativeBridge.java').read_text(encoding='utf-8'))
    output.mkdir(parents=True)
    for name in ['src','verified-maven','numen-deps','auth-libs']:shutil.copytree(baseline_build/name,output/name)
    for name in ['build.gradle','settings.gradle','auth-dependencies.json']:shutil.copy2(baseline_build/name,output/name)
    dest=output/'src/main/java/dev/qiandeng/maw/saoforge';(dest/'NativeBridge.java').write_text(text,encoding='utf-8')
    gameplay=(dest/'SaoGameplay.java').read_text(encoding='utf-8')
    before='case "sao.status"->SaoRpg.status(p);'
    if gameplay.count(before)!=1:raise ValueError('sao_read_dispatch_changed')
    gameplay=gameplay.replace(before,before+'\n        case "sao.recipes"->{var recipes=new JsonObject();SaoRecipes.query(p,args,recipes);yield recipes;}')
    before='out.addProperty("status","ok");out.addProperty("outcomeKnown",true);'
    if gameplay.count(before)!=1:raise ValueError('sao_read_receipt_changed')
    gameplay=gameplay.replace(before,before+'if(operation.equals("sao.recipes")){var d=out.getAsJsonObject("data");out.add("status",d.get("status"));out.add("complete",d.get("complete"));if(d.has("partialReason"))out.add("partialReason",d.get("partialReason"));}')
    (dest/'SaoGameplay.java').write_text(gameplay,encoding='utf-8')
    for name in ['RecipeDefinitions.java','SaoRecipes.java','MenuFacts.java','mixins/RecipeManagerMixin.java','mixins/KubeRecipeDecodeMixin.java','mixins/KubeRecipeReloadMixin.java']:shutil.copy2(HERE/'forge-addon/src/main/java/dev/qiandeng/maw/saoforge'/name,dest/name)
    resources=output/'src/main/resources'
    shutil.copy2(HERE/'sao-operations.json',resources/'sao-operations.json')
    shutil.copy2(HERE/'forge-addon/src/main/resources/maw_sao_recipes.mixins.json',resources/'maw_sao_recipes.mixins.json')
    gradle=(output/'build.gradle').read_text(encoding='utf-8').replace("version = '0.1.1'","version = '0.1.2'")
    gradle+='\njar { manifest { attributes("MixinConfigs": "maw_numen_server.mixins.json,maw_sao_auth.mixins.json,maw_sao_recipes.mixins.json") } }\n'
    (output/'build.gradle').write_text(gradle,encoding='utf-8')
    meta=resources/'META-INF/mods.toml';meta.write_text(meta.read_text(encoding='utf-8').replace('version="0.1.1"','version="0.1.2"'),encoding='utf-8')
    contract_file=resources/'native-operations.json';contract=json.loads(contract_file.read_bytes());contract['version']='0.1.2'
    for op in contract['operations']:
        if op['id']=='native.recipes':
            op['description']='Read this authenticated player connection\'s loaded Forge recipes and exact successful decoder inputs. Up to 12 rows and 16 KiB, nextOffset on partial pages. Select recipeId/type/outputId; output matches declared display results only. Ingredients are alternative choices, not simultaneous inputs. Missing source definitions and context-dependent outputs stay explicit. Read definitions do not execute or verify a machine.'
            op['example']={'outputId':'farmersdelight:canvas','limit':2}
    contract_file.write_text(json.dumps(contract,indent=2),encoding='utf-8')
    files={p.relative_to(output).as_posix():sha(p) for p in output.rglob('*') if p.is_file()}
    record={'schemaVersion':1,'baselineSha256':BASELINE_SHA,'candidateVersion':'0.1.2','installed':False,'authenticationChanged':False,
        'thirdPartyModified':False,'sourceFiles':files,'builderSha256':sha(Path(__file__))}
    (output/'native-data-build.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
    return {'prepared':str(output),'installed':False,'baselineSha256':BASELINE_SHA,'files':len(files)}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['baseline-build','baseline-jar','output']:p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();print(json.dumps(prepare(a.baseline_build,a.baseline_jar,a.output)))
