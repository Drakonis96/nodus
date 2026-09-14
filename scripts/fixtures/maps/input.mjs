export const source = {label:'Synthetic test geometry', attribution:'Nodus deterministic test data', license:'CC0'};
export const geometry = {type:'FeatureCollection',features:[
  {type:'Feature',id:'west',properties:{name:'West',category:'A'},geometry:{type:'Polygon',coordinates:[[[-6,38],[-3,38],[-3,41],[-6,41],[-6,38]]]}},
  {type:'Feature',id:'east',properties:{name:'East',category:'B'},geometry:{type:'Polygon',coordinates:[[[-3,38],[0,38],[0,41],[-3,41],[-3,38]]]}},
]};
export const request = {title:'Deterministic map',alt:'Two synthetic regions with coordinate markers and a connection.',layers:[{data:{geojson:geometry,source},colors:{property:'category',values:[{value:'A',color:'#675dc1'},{value:'B',color:'#60a69c'}]},labelProperty:'name'}],markers:[{coordinates:[-4,39],label:'Site A'},{coordinates:[-1,40],label:'Site B'}],routes:[{coordinates:[[-4,39],[-1,40]],kind:'curved',arrow:true}],overlaySource:source,legend:[{label:'Category A',color:'#675dc1'},{label:'Category B',color:'#60a69c'}]};
