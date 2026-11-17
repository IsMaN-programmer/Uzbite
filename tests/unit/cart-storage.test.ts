import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCart, parseCart, saveCart, type CartItem} from '../../apps/frontend/src/lib/cartStorage.js';

const item: CartItem = {dishId:'pasta', restaurantId:'one', name:'Pasta', price:58000, imageUrl:'/pasta.jpg', quantity:2};
test('A saved cart survives reload and remains private to its account', () => {
  const values = new Map<string,string>();
  const storage = {getItem:(key:string) => values.get(key) ?? null, setItem:(key:string,value:string) => {values.set(key,value);}};
  assert.equal(saveCart('alice',[item],storage),true);
  assert.deepEqual(loadCart('bob',storage),[]);
  assert.deepEqual(loadCart('alice',storage),[item]);
  saveCart('bob',[],storage);
  assert.deepEqual(loadCart('alice',storage),[item]);
});
test('Corrupt, duplicate and mixed-restaurant stored carts cannot enter checkout state', () => {
  for (const raw of ['{broken', '{}', JSON.stringify([item,item]), JSON.stringify([item,{...item,dishId:'other',restaurantId:'two'}]), JSON.stringify([{...item,quantity:-1}]), JSON.stringify([{...item,price:'NaN'}])]) {
    assert.deepEqual(parseCart(raw),[]);
  }
});
test('Unavailable browser storage keeps the application usable and reports persistence failure', () => {
  const blocked = {getItem:() => {throw new Error('blocked');},setItem:() => {throw new Error('quota');}};
  assert.deepEqual(loadCart('alice',blocked),[]);
  assert.equal(saveCart('alice',[item],blocked),false);
});
