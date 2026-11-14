import { describe, expect, it } from 'vitest';
import { collectActionIds, isAuthMeLoginDialog, minecraftTextComponent, unwrapNbt, windowTitleText } from '../core/nbt-text.mjs';

const authMeRaw = {
  type: 'compound',
  value: {
    type: { type: 'string', value: 'minecraft:multi_action' },
    after_action: { type: 'string', value: 'wait_for_response' },
    title: { type: 'compound', value: { color: { type: 'string', value: 'gold' }, text: { type: 'string', value: '登录' } } },
    body: { type: 'compound', value: {
      type: { type: 'string', value: 'minecraft:plain_message' },
      contents: { type: 'compound', value: { color: { type: 'string', value: 'gray' }, text: { type: 'string', value: '请输入您的密码以继续。' } } },
    } },
    inputs: { type: 'list', value: { type: 'compound', value: [{
      key: { type: 'string', value: 'password' },
      type: { type: 'string', value: 'minecraft:text' },
      label: { type: 'compound', value: { text: { type: 'string', value: '密码' } } },
    }] } },
    actions: { type: 'list', value: { type: 'compound', value: [
      { action: { type: 'compound', value: {
        type: { type: 'string', value: 'minecraft:dynamic/custom' },
        id: { type: 'string', value: 'authme:prejoin-login/submit' },
      } }, label: { type: 'compound', value: { color: { type: 'string', value: 'green' }, text: { type: 'string', value: '登录' } } } },
      { action: { type: 'compound', value: {
        type: { type: 'string', value: 'minecraft:dynamic/custom' },
        id: { type: 'string', value: 'authme:prejoin-login/cancel' },
      } }, label: { type: 'compound', value: { color: { type: 'string', value: 'red' }, text: { type: 'string', value: '取消' } } } },
    ] } },
  },
};

const menuTitleNbt = {
  type: 'compound',
  value: {
    text: { type: 'string', value: '' },
    extra: { type: 'list', value: { type: 'compound', value: [
      { bold: { type: 'byte', value: 1 }, color: { type: 'string', value: 'red' }, text: { type: 'string', value: '||' } },
      { bold: { type: 'byte', value: 1 }, color: { type: 'string', value: 'dark_aqua' }, text: { type: 'string', value: '主菜单' } },
      { bold: { type: 'byte', value: 1 }, color: { type: 'string', value: 'red' }, text: { type: 'string', value: '||' } },
    ] } },
  },
};

describe('26.1 NBT unwrap', () => {
  it('unwraps an AuthMe pre-join dialog and finds the submit id', () => {
    const unwrapped = unwrapNbt(authMeRaw) as { title: { text: string }; inputs: Array<{ key: string }> };
    expect(unwrapped.title.text).toBe('登录');
    expect(unwrapped.inputs[0].key).toBe('password');
    expect(collectActionIds(authMeRaw)).toEqual([
      'authme:prejoin-login/submit',
      'authme:prejoin-login/cancel',
    ]);
    expect(isAuthMeLoginDialog(authMeRaw)).toBe(true);
    expect(isAuthMeLoginDialog(unwrapNbt(authMeRaw))).toBe(true);
    expect(isAuthMeLoginDialog({ type: 'minecraft:notice', title: { text: '规则' } })).toBe(false);
  });

  it('renders anonymous NBT window titles instead of [object Object]', () => {
    expect(String(menuTitleNbt)).toBe('[object Object]');
    expect(windowTitleText(menuTitleNbt)).toBe('||主菜单||');
    expect(minecraftTextComponent(menuTitleNbt)).toBe('||主菜单||');
    expect(windowTitleText({ extra: [{ text: '||' }, { text: '秘境' }, { text: '||' }], text: '' })).toBe('||秘境||');
  });
});
