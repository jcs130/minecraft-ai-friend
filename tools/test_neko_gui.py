import unittest
from probe_neko_gui import check_gui


class NativeGuiProbeTest(unittest.TestCase):
    def fixture(self):
        player = '11111111-1111-4111-8111-111111111111'
        trial = {'phase': 'observing', 'qwenpawConnected': False, 'current': {'playerUuid': player,
                 'native': {'mutationBlocked': False, 'unresolved': []}}}
        web = {'ok': True, 'ready': True, 'presentation': {'playerUuid': player,
               'nativeMenu': {'playerUuid': player, 'menuType': 'curios:curios_container',
                              'slots': [{'slot': 0, 'item': None}], 'slotLayout': [{'slot': 0, 'x': -25, 'y': 8}]},
               'skills': {'playerUuid': player, 'source': 'ars_nouveau_receipt', 'stale': False, 'observedAt': 1000}}}
        return web, trial

    def test_real_owned_live_data(self):
        web, trial = self.fixture()
        self.assertTrue(check_gui(web, trial, 1500)['ok'])

    def test_stale_or_other_player_or_unknown_write_cannot_pass(self):
        web, trial = self.fixture()
        self.assertFalse(check_gui(web, trial, 7000)['ok'])
        web['presentation']['nativeMenu']['playerUuid'] = 'another-player'
        self.assertFalse(check_gui(web, trial, 1500)['ok'])
        web, trial = self.fixture()
        trial['current']['native']['unresolved'] = [{'callId': 'unresolved'}]
        self.assertFalse(check_gui(web, trial, 1500)['ok'])


if __name__ == '__main__':
    unittest.main()
