"""Inference failures stop bounded QA; partial business progress never means goal success."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('resident_online',Path(__file__).with_name('resident-online-stage.py'))
online=importlib.util.module_from_spec(spec)
spec.loader.exec_module(online)


def outcome(status,reason):
    return {'receipt':{'status':status,'reason':reason}}


class BenchmarkBudget(unittest.TestCase):
    def test_repeated_unavailable_stops_after_three(self):
        failed=outcome('failed','model_unavailable')
        self.assertIsNone(online.repeated_failure([failed,failed]))
        self.assertEqual(online.repeated_failure([failed]*3),'repeated_model_unavailable')

    def test_a_success_resets_failure_streak(self):
        self.assertIsNone(online.repeated_failure([outcome('failed','model_unavailable')]*2+[outcome('completed','observed')]))

    def test_changed_error_requires_separate_diagnosis(self):
        self.assertIsNone(online.repeated_failure([outcome('failed','model_unavailable'),outcome('rejected','invalid_model_action'),outcome('failed','model_unavailable')]))

    def test_business_refusal_is_not_provider_failure(self):
        self.assertIsNone(online.repeated_failure([outcome('blocked','verification_throttled')]*3))

    def proof_after_sale(self):
        proof=online.ObjectiveProof()
        proof.observe({'status':'completed','command':'guild claim','serviceReceipt':{'goalCompleted':True,'before':{'activeId':'tm_resident_delivery'}}},[])
        proof.observe({'status':'completed','command':'arena recycle sell quote','serviceReceipt':{'item':{'id':'minecraft:iron_sword'}}},[])
        return proof

    def test_buying_nonfood_or_queued_food_is_not_completion(self):
        proof=self.proof_after_sale()
        proof.observe({'status':'completed','command':'arena shop buy sword','serviceReceipt':{'quantity':1,'item':{'id':'minecraft:diamond_sword'}}},[{'id':'minecraft:diamond_sword','count':1}])
        self.assertFalse(proof.goal);self.assertIsNone(proof.purchased)
        proof.observe({'status':'completed','command':'arena shop buy food','serviceReceipt':{'quantity':8,'item':{'id':'minecraft:cooked_beef'}}},[{'id':'minecraft:cooked_beef','count':2}])
        self.assertFalse(proof.goal)

    def test_only_actual_post_purchase_food_transfer_completes_objective(self):
        proof=self.proof_after_sale();food=[{'id':'minecraft:cooked_beef','count':2}]
        proof.observe({'status':'completed','command':'arena shop buy food','serviceReceipt':{'quantity':8,'item':{'id':'minecraft:cooked_beef'}}},food)
        take={'status':'completed','command':'arena stash take 1 8','serviceReceipt':{'id':'minecraft:cooked_beef','moved':8}}
        self.assertFalse(proof.observe(take,food))
        self.assertTrue(proof.observe(take,[{'id':'minecraft:cooked_beef','count':10}]))

    def test_failed_sale_or_unconfirmed_take_never_completes(self):
        proof=self.proof_after_sale()
        proof.observe({'status':'completed','command':'arena shop buy food','serviceReceipt':{'quantity':8,'item':{'id':'minecraft:cooked_beef'}}},[])
        self.assertFalse(proof.observe({'status':'unknown','command':'arena stash take 1 8','serviceReceipt':{'id':'minecraft:cooked_beef','moved':8}},[{'id':'minecraft:cooked_beef','count':8}]))

    def test_native_eating_gap_requires_actual_later_bag_delta(self):
        proof=self.proof_after_sale()
        proof.observe({'status':'completed','command':'arena shop buy food','serviceReceipt':{'quantity':8,'item':{'id':'minecraft:cooked_beef'}}},[])
        self.assertFalse(proof.observe_inventory([{'id':'minecraft:cooked_beef','count':7}]))
        self.assertFalse(proof.observe({'status':'completed','command':'arena stash take 1 8','serviceReceipt':{'baseId':'minecraft:cooked_beef','moved':8}},[]))
        self.assertFalse(proof.observe_inventory([]))
        self.assertTrue(proof.observe_inventory([{'id':'minecraft:cooked_beef','count':7}]))

    def test_unrelated_or_unconfirmed_transfer_cannot_use_later_food(self):
        for status,item in [('unknown','minecraft:cooked_beef'),('completed','minecraft:bread')]:
            proof=self.proof_after_sale()
            proof.observe({'status':'completed','command':'arena shop buy food','serviceReceipt':{'quantity':8,'item':{'id':'minecraft:cooked_beef'}}},[])
            proof.observe({'status':status,'command':'arena stash take 1 8','serviceReceipt':{'baseId':item,'moved':8}},[])
            self.assertFalse(proof.observe_inventory([{'id':'minecraft:cooked_beef','count':7}]))

    def test_new_purchase_cannot_reuse_a_previous_transfer(self):
        proof=self.proof_after_sale()
        buy={'status':'completed','command':'arena shop buy food','serviceReceipt':{'quantity':8,'item':{'id':'minecraft:cooked_beef'}}}
        proof.observe(buy,[])
        proof.observe({'status':'completed','command':'arena stash take 1 8','serviceReceipt':{'baseId':'minecraft:cooked_beef','moved':8}},[])
        proof.observe(buy,[])
        self.assertFalse(proof.observe_inventory([{'id':'minecraft:cooked_beef','count':7}]))


if __name__=='__main__':unittest.main()
