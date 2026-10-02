// The Chemistry Studio setting that switches the user's commercial stock lists on or off.
const KEYS = [
  "Química (Chemistry Studio)",
  "Usar listas de stock comerciales",
  "La búsqueda de rutas se detiene en los precursores que tus listas de proveedores tienen en stock, y el informe indica qué materiales de partida, o el propio objetivo, se pueden comprar. Desactívalo para planificar rutas sin tener en cuenta lo que se vende. Solo actúa si has importado alguna lista.",
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== KEYS.length) throw new Error('Chemistry stock translations are incomplete.');
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

export const CHEMISTRY_STOCK_TRANSLATIONS = {
  "en": table([
    "Chemistry (Chemistry Studio)",
    "Use commercial stock lists",
    "Route search stops at precursors your vendor lists have in stock, and the report says which starting materials, or the target itself, can be bought. Turn it off to plan routes without regard to what is for sale. Only applies once you have imported a list.",
  ]),
  "fr": table([
    "Chimie (Chemistry Studio)",
    "Utiliser les listes de stock commerciales",
    "La recherche de voies s’arrête aux précurseurs que vos listes de fournisseurs ont en stock, et le rapport indique quels produits de départ, ou la cible elle-même, peuvent être achetés. Désactivez-la pour planifier des voies sans tenir compte de ce qui est en vente. Ne s’applique qu’une fois une liste importée.",
  ]),
  "de": table([
    "Chemie (Chemistry Studio)",
    "Kommerzielle Lagerlisten verwenden",
    "Die Routensuche endet bei Vorstufen, die Ihre Lieferantenlisten auf Lager haben, und der Bericht nennt, welche Ausgangsstoffe oder das Zielmolekül selbst gekauft werden können. Ausschalten, um Routen ohne Rücksicht auf das Angebot zu planen. Wirkt erst, wenn eine Liste importiert wurde.",
  ]),
  "pt": table([
    "Química (Chemistry Studio)",
    "Usar listas de stock comerciais",
    "A pesquisa de rotas para nos precursores que as suas listas de fornecedores têm em stock, e o relatório indica que materiais de partida, ou o próprio alvo, podem ser comprados. Desative para planear rotas sem ter em conta o que está à venda. Só se aplica depois de importar uma lista.",
  ]),
  "pt-BR": table([
    "Química (Chemistry Studio)",
    "Usar listas de estoque comerciais",
    "A busca de rotas para nos precursores que suas listas de fornecedores têm em estoque, e o relatório indica quais materiais de partida, ou o próprio alvo, podem ser comprados. Desative para planejar rotas sem considerar o que está à venda. Só vale depois que você importar uma lista.",
  ]),
  "it": table([
    "Chimica (Chemistry Studio)",
    "Usa gli elenchi di magazzino commerciali",
    "La ricerca delle vie si ferma ai precursori che i tuoi elenchi di fornitori hanno a magazzino, e il rapporto indica quali materiali di partenza, o il bersaglio stesso, si possono acquistare. Disattivala per pianificare vie senza tener conto di ciò che è in vendita. Vale solo dopo aver importato un elenco.",
  ]),
  "tr": table([
    "Kimya (Chemistry Studio)",
    "Ticari stok listelerini kullan",
    "Rota araması, tedarikçi listelerinizde stokta olan öncüllerde durur ve rapor hangi başlangıç maddelerinin ya da hedefin kendisinin satın alınabileceğini belirtir. Satılanları dikkate almadan rota planlamak için kapatın. Yalnızca bir liste içe aktardıktan sonra geçerlidir.",
  ]),
  "zh-CN": table([
    "化学（Chemistry Studio）",
    "使用商业库存清单",
    "路线搜索会在供应商清单中有现货的前体处停止，报告会说明哪些起始原料或目标物本身可以购买。关闭后规划路线时不考虑可购买的化合物。仅在导入清单后生效。",
  ]),
  "zh-TW": table([
    "化學（Chemistry Studio）",
    "使用商業庫存清單",
    "路線搜尋會在供應商清單中有現貨的前驅物處停止，報告會說明哪些起始原料或目標物本身可以購買。關閉後規劃路線時不考慮可購買的化合物。僅在匯入清單後生效。",
  ]),
  "ja": table([
    "化学（Chemistry Studio）",
    "市販品の在庫リストを使う",
    "経路探索は、仕入先リストに在庫のある前駆体で止まり、レポートにはどの出発物質、あるいは標的化合物そのものが購入できるかが示されます。販売品を考慮せずに経路を計画するにはオフにします。リストをインポートした後にのみ適用されます。",
  ]),
  "ko": table([
    "화학 (Chemistry Studio)",
    "상용 재고 목록 사용",
    "경로 탐색은 공급업체 목록에 재고가 있는 전구체에서 멈추고, 보고서는 어떤 출발 물질 또는 표적 화합물 자체를 구입할 수 있는지 알려 줍니다. 판매 여부와 관계없이 경로를 계획하려면 끄세요. 목록을 가져온 뒤에만 적용됩니다.",
  ]),
} as const;
