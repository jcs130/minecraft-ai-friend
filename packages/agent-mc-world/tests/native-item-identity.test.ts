import {expect,it} from 'vitest';
import {nativeItemName} from '../core/native-item-identity.ts';
import {invItemNamed,invCount} from '../core/inventory.ts';
it('selects and counts original mod items while leaving the wire objects intact',()=>{
 const item={name:'paper',count:3,type:100};
 Object.defineProperty(item,Symbol.for('mcviewer.native_item.v1'),{value:{name:'create:andesite_casing',count:3,registrySha256:'a'.repeat(64),source:'same_connection_original_before_projection'}});
 const bot={inventory:{items:()=>[item]},registry:{itemsByName:{paper:{id:100}}}} as never;
 expect(invItemNamed(bot,'create:andesite_casing')).toBe(item);
 expect(invItemNamed(bot,'paper')).toBeUndefined();
 expect(invCount(bot,n=>n==='create:andesite_casing')).toBe(3);
 expect(item).toEqual({name:'paper',count:3,type:100});
 item.count=2;expect(nativeItemName(item)).toBe('paper');
});
