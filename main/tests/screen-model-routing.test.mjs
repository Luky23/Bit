import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('la elaboración de pantalla respeta el modelo rápido y el chat común conserva la selección manual',async()=>{
  const source=readFileSync(new URL('../electron/main.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  const chatClient = {');
  const end=source.indexOf('\n  const executeWorkspaceTool',start);
  for(const screenQuestion of [true,false]){
    const context=vm.createContext({model:'pesado:7b',fallbackModels:['rapido:3b'],message:'consulta',
      isScreenQuestion:()=>screenQuestion,signal:{throwIfAborted(){}},
      modelService:{resolveModel:async name=>name,generate:async model=>({model})},
    });
    vm.runInContext(source.slice(start,end)+'\nglobalThis.client=chatClient;',context);
    const result=await context.client.generate('rapido:3b',{});
    assert.equal(result.model,screenQuestion?'rapido:3b':'pesado:7b');
  }
});
