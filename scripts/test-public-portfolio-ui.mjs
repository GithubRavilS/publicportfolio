/** Regression: a stale snapshot must remain readable in every portfolio view. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../public-portfolio-v2.html',import.meta.url),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const elements=new Map();
function element(selector){if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',hidden:false,classList:{add(){},remove(){},toggle(){}}});return elements.get(selector)}
const context=vm.createContext({console,Date,Intl,Number,URL,URLSearchParams,window:{location:{search:''}},document:{documentElement:{lang:'ru'},querySelector:element,querySelectorAll:()=>[]}});
vm.runInContext(script.slice(0,script.indexOf('let chartState')),context);
vm.runInContext(script.slice(script.indexOf('function render(){'),script.indexOf('function setPage(')),context);
vm.runInContext('function drawChart(){}',context);
const timestamp='2020-01-01T00:00:00Z';
context.snapshot={meta:{updatedAt:timestamp,stale:true,liveFromEndpoint:true,mode:'live'},summary:{netWorthUsd:1500,collateralUsd:1000,debtUsd:100,liquidityUsd:500,walletIdleUsd:50,healthFactor:2},history:[],positions:[
 {id:'lp',type:'liquidity',protocol:'DEX',chain:'Base',asset:'ETH/USDC',valueUsd:500,ratePct:12.34,rewardUsd:5,walletLabel:'PRIVATE WALLET',details:{sourceTimestamp:timestamp,feeTierPct:.045,rangeMin:1000,rangeMax:3000,inRange:true,earnings:{totalEarnedUsd:15}}},
 {id:'loan',type:'lending',protocol:'Lend',chain:'Base',asset:'ETH',valueUsd:900,collateralUsd:1000,debtUsd:100,healthFactor:2,details:{sourceTimestamp:timestamp}},
 {id:'yield',type:'yield',protocol:'Yield',chain:'Base',asset:'PT',valueUsd:50,ratePct:8,rewardUsd:0,details:{sourceTimestamp:timestamp}},
 {id:'wallet',type:'wallet',protocol:'Wallet',chain:'Base',asset:'USDC',valueUsd:50,rewardUsd:0,details:{sourceTimestamp:timestamp}},
 {id:'reward',type:'rewards',protocol:'Lend',chain:'Base',asset:'TOKEN',valueUsd:0,rewardUsd:2,details:{sourceTimestamp:timestamp}}
]};
vm.runInContext('data=snapshot;render()',context);
assert.equal(element('#totalEquity').textContent,'$1,500');
assert(element('#debtContent').innerHTML.includes('$100'));
assert(element('#freshnessNotice').innerHTML.includes('Показан последний доступный снимок'));
for(const filter of ['all','collateral','lending','liquidity','yield','wallet','rewards']){
 context.filter=filter;vm.runInContext('posFilter=filter;renderPositions(data.positions)',context);
 assert(!element('#positionsTable').innerHTML.includes('Нет актуальных данных'));
 assert(!element('#positionsTable').innerHTML.includes('PRIVATE WALLET'));
 assert(!element('#positionsHead').innerHTML.includes('Кошелёк'));
 if(filter==='liquidity')for(const text of ['$500.00','12.34%','0.045%','1,000 – 3,000','$15.00'])assert(element('#positionsTable').innerHTML.includes(text),text);
}
vm.runInContext('openDrawer("lp")',context);
assert(element('#drawerContent').innerHTML.includes('12.34%'));
assert(!element('#drawerContent').innerHTML.includes('PRIVATE WALLET'));
context.snapshot.positions[0].details.isFullRange=true;context.snapshot.positions[0].details.rangeMin=null;context.snapshot.positions[0].details.rangeMax=null;vm.runInContext('posFilter="liquidity";renderPositions(data.positions)',context);assert(element('#positionsTable').innerHTML.includes('Полный диапазон'));
context.snapshot.positions[0].ratePct=null;
vm.runInContext('posFilter="liquidity";renderPositions(data.positions)',context);
assert(element('#positionsTable').innerHTML.includes('Нет данных'));
assert(element('#positionsTable').innerHTML.includes('$500.00'));
vm.runInContext('data={meta:{mode:"error"},summary:{},positions:[],history:[]};render()',context);
assert.equal(element('#totalEquity').textContent,'—');
console.log('PASS: stale snapshot values, all seven filters, LP metrics, details, privacy, missing field isolation and API error.');
