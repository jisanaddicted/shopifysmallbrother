const BASE='http://localhost:5000/api';
const api=async(m,p,{token,body}={})=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});let d=null;try{d=await r.json()}catch{}return{s:r.status,d}};
const stamp=Date.now().toString(36);

// 1. the demo customer session - what does the backend hand back?
const cust=await api('POST','/auth/login',{body:{email:'customer@example.com',password:'password123'}});
console.log('customer login  stores:', JSON.stringify(cust.d?.stores));
const me=await api('GET','/auth/me',{token:cust.d?.token});
console.log('customer /me    stores:', JSON.stringify(me.d?.stores), '| role:', me.d?.user?.role);

// 2. fresh owner+store, product created the way the UI does with stock left BLANK
const own=await api('POST','/auth/register',{body:{name:`Leak ${stamp}`,email:`leak.${stamp}@example.com`,username:`leak.${stamp}`,password:'password123',role:'store',storeName:`Leak Store ${stamp}`}});
const ot=own.d?.token; const store=own.d?.store;
const p0=await api('POST','/products',{token:ot,body:{name:`Blank Stock ${stamp}`,price:3,category:'Probe'}});
console.log('UI-created product   stock:', p0.d?.product?.stock);

// 3. customer tries to order it
const ord0=await api('POST','/orders',{token:cust.d?.token,body:{items:[{productId:p0.d?.product?._id,quantity:1}],address:{line1:'1 Probe',city:'Kathmandu',phone:'+1 555'},location:{lat:27.7,lng:85.3}}});
console.log('order blank-stock    ->', ord0.s, ord0.d?.message||'OK');

// 4. owner stocks it, customer orders again
await api('PUT',`/products/${p0.d?.product?._id}`,{token:ot,body:{name:`Blank Stock ${stamp}`,price:3,stock:5,category:'Probe'}});
const ord1=await api('POST','/orders',{token:cust.d?.token,body:{items:[{productId:p0.d?.product?._id,quantity:1}],address:{line1:'1 Probe',city:'Kathmandu',phone:'+1 555'},location:{lat:27.7,lng:85.3}}});
const oid=String(ord1.d?.order?._id||'');
console.log('order stocked(5)     ->', ord1.s, oid||ord1.d?.message);

// 5. does the order reach the store dashboard list and the customer list?
const list=await api('GET','/orders/store/mine',{token:ot});
const ids=(list.d?.orders||[]).map(o=>String(o._id||o.id));
console.log('store/mine           ->', list.s, 'count:', ids.length, ids.includes(oid)?'CONTAINS new order':'MISSING new order');
const mine=await api('GET','/orders/mine',{token:cust.d?.token});
const mids=(mine.d?.orders||[]).map(o=>String(o._id||o.id));
console.log('customer /mine       ->', mine.s, 'count:', mids.length, mids.includes(oid)?'CONTAINS new order':'MISSING new order');

// 6. a PENDING invitee must not get a store session either
const st2=await api('POST','/auth/register',{body:{name:`P ${stamp}`,email:`p.${stamp}@example.com`,username:`p.${stamp}`,password:'password123',role:'customer'}});
await api('POST',`/stores/${store._id}/riders`,{token:ot,body:{username:`p.${stamp}`,role:'admin'}});
const pl=await api('POST','/auth/login',{body:{email:`p.${stamp}@example.com`,password:'password123'}});
console.log('pending invitee      stores:', JSON.stringify(pl.d?.stores));

// 7. cleanup: revoke pending, delete store is not needed (probe stores pile up harmlessly)
console.log('\nprobe store slug:', store?.slug);
