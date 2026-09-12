export const date = '2026-09-12T10:00:00.000Z';
export const researchText = `## Del ingreso a la consulta

Este ejemplo utiliza datos sintéticos para mostrar cómo un informe puede incorporar recursos visuales sin interrumpir su argumento. Imaginemos un pequeño archivo que recibe documentos, los describe y finalmente los pone a disposición de sus lectores. El propósito de la figura es explicar esa secuencia. No representa una investigación sobre una institución real ni contiene resultados obtenidos de una biblioteca personal.

El primer paso registra la procedencia y comprueba que el documento pueda abrirse. Después se redacta una descripción breve que permita reconocer su contenido. La publicación reúne ambos elementos para que otra persona pueda localizar el material y comprender por qué resulta relevante. El esquema convierte estos tres movimientos en una secuencia visible, manteniendo las explicaciones y los matices dentro del texto.

## Una comparación que ayuda a interpretar

Para ilustrar la lectura de un gráfico se han asignado doce documentos al ingreso, ocho a la descripción y cinco a la consulta. Son cantidades inventadas exclusivamente para esta demostración. La diferencia entre etapas sugiere dónde mirar en un caso real, pero no demuestra por sí misma un problema. Algunos documentos podrían requerir permisos adicionales o una descripción más detallada antes de publicarse.

El gráfico hace más rápida la comparación, mientras este párrafo conserva su interpretación y sus límites. Ambas piezas cumplen funciones distintas y se complementan. La figura no sustituye a la explicación ni añade datos que el texto no haya presentado. Su pie recuerda el carácter sintético de las cantidades para que la imagen siga siendo comprensible cuando se consulte de forma aislada.

Un informe útil puede terminar sin figuras cuando estas no aportan claridad. En este ejemplo se permiten cuatro llamadas a SVG Studio, pero solo se necesita un esquema. El máximo representa una autorización limitada, no una obligación de completar una colección de imágenes.`;

export const immersionOverview = `Esta inmersión de demostración propone una pregunta sencilla: ¿cómo se relaciona un dibujo plano con un objeto que ocupa espacio? El recorrido usa un cubo como ejemplo y combina una explicación breve con recursos que pueden observarse a distinto ritmo. No contiene respuestas de estudiantes ni información extraída de una biblioteca personal.

El esquema inicial propone tres acciones: observar la forma, girarla para descubrir lo que queda oculto y explicar con palabras propias lo aprendido. La secuencia orienta la actividad sin imponer una respuesta ni convertir cada paso en una prueba. El recurso visual permanece junto a la explicación que le da sentido.`;
export const immersionLesson = `Un cubo tiene seis caras cuadradas. Desde una sola perspectiva no suelen verse todas a la vez, de modo que una imagen plana obliga a imaginar parte de su estructura. El modelo tridimensional permite girar el objeto y comprobar cómo cambia su apariencia mientras conserva la misma forma. La interacción sirve aquí para examinar una relación espacial concreta.

Observa primero el objeto sin moverlo y localiza las caras visibles. Después gíralo lentamente hasta reconocer una cara que antes quedaba oculta. El cambio de perspectiva no añade nuevas caras al cubo: modifica cuáles puedes observar. Esta diferencia entre la forma y su representación es la idea central del ejercicio.

La vista estática del informe conserva una orientación clara del mismo modelo. Al exportar el documento a PDF, esa imagen mantiene la relación con el texto y evita dejar un espacio vacío donde estaba el visor interactivo. Puedes volver a la aplicación cuando necesites explorar otras perspectivas.

Para cerrar, describe qué información te ha proporcionado el giro y qué información ya ofrecía el esquema. No hace falta añadir otra figura si puedes explicar la relación con claridad. Las skills activadas son posibilidades disponibles; la selección final depende de su utilidad para comprender el contenido.`;

export function diagram(labels, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 255"><title>${title}</title><desc>Tres etapas conectadas de izquierda a derecha.</desc><rect width="1000" height="255" rx="12" fill="#f4f5fb"/><text x="38" y="46" font-family="Arial" font-size="20" fill="#6c6b86">${title}</text>${labels.map((label,i) => `<rect x="${38+i*324}" y="83" width="275" height="123" rx="12" fill="${['#ebe9fa','#e3eff0','#edeaf5'][i]}"/><text x="${60+i*324}" y="119" font-family="Arial" font-size="18" fill="#787491">0${i+1}</text><text x="${60+i*324}" y="164" font-family="Arial" font-size="28" fill="#30334e">${label}</text>${i<2?`<path d="M${322+i*324} 146h25m-8-8 8 8-8 8" fill="none" stroke="#827aab" stroke-width="3"/>`:''}`).join('')}</svg>`;
}

export const chart = { kind: 'chart', chartType: 'bar', title: 'Documentos por etapa', alt: 'Datos sintéticos: ingreso 12, descripción 8 y consulta 5.', xLabel: 'Etapa', yLabel: 'Documentos', series: [{ label: 'Demostración', points: [['Ingreso',12],['Descripción',8],['Consulta',5]] }] };

export function cubeGltf() {
  const positions = new Float32Array([-1,-1,1,1,-1,1,1,1,1,-1,1,1,-1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1]);
  const indices = new Uint16Array([0,1,2,0,2,3,1,5,6,1,6,2,5,4,7,5,7,6,4,0,3,4,3,7,3,2,6,3,6,7,4,5,1,4,1,0]);
  const buffer = Buffer.concat([Buffer.from(positions.buffer),Buffer.from(indices.buffer)]);
  return Buffer.from(JSON.stringify({asset:{version:'2.0',generator:'Nodus synthetic visual QA'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[0.4,0.36,0.73,1],metallicFactor:0,roughnessFactor:0.7},doubleSided:true}],buffers:[{byteLength:buffer.length,uri:`data:application/octet-stream;base64,${buffer.toString('base64')}`}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:indices.byteLength}],accessors:[{bufferView:0,componentType:5126,count:8,type:'VEC3',min:[-1,-1,-1],max:[1,1,1]},{bufferView:1,componentType:5123,count:36,type:'SCALAR'}]}));
}

export function draftFixture() {
  return { generatedAt:date,title:'Del archivo al lector',abstract:'Demostración breve con datos sintéticos y dos recursos complementarios.',brief:{kind:'deep_research',objective:'Explicar un flujo documental con recursos pertinentes.',language:'es'},selection:{ideaIds:[],themeIds:[],gapIds:[],contradictionIds:[],workIds:[],passageIds:[],tutorRouteIds:[]},outline:[],deepResearchStructure:'single',draftMarkdown:researchText,matrix:[],bibliography:[],nextSteps:[],limitations:[],stats:{selectedIdeas:0,selectedThemes:0,selectedGaps:0,selectedContradictions:0,selectedWorks:0,selectedPassages:0,selectedTutorRoutes:0,contextChars:researchText.length,truncated:false} };
}
export function immersionFixture() {
  return { title:'Mirar, girar, comprender',topic:'La forma y su representación',language:'es',minutes:15,generatedAt:date,model:null,overview:immersionOverview,keyTerms:[],stations:[{id:'cube',title:'Una forma, varias perspectivas',question:'¿Qué cambia cuando giramos un cubo?',minutes:10,context:'',synthesis:immersionLesson,citations:[],positions:[],takeaways:[],ideaIds:[],quiz:[]}],contrasts:{authors:[],rows:[]},frontiers:[],exam:{questions:[],feynman:''},graph:{nodes:[],edges:[]},ideaIndex:[],stats:{stations:1,ideas:0,works:0,authors:0,citations:0,quizQuestions:0},stoppedReason:null };
}
