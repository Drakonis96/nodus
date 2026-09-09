# legalize-ee

Eesti — õigusaktid Markdown-vormingus, versioonihallatuna git-repositooriumina.

Iga seadus on fail; iga reform on commit, mille kuupäev vastab tegelikule ametlikule avaldamiskuupäevale. Mis tahes seaduse `git log` näitab selle täielikku ajalugu — millal see jõustus, millised artiklid muutusid ja millise normiga.

Repositoorium katab Riigi Teataja konsolideeritud õigusaktid, mis on piiratud dokumendiliikidega seadus ja määrus (tekstiliigid terviktekst ja algtekst-terviktekst). Iga seadus on eraldi fail ja iga reform on git-commit, mis on dateeritud akti ametliku jõustumiskuupäeva järgi.

## Mis on sees

- **Seadused** (`{globaalID}.md`) — `ee/115052015002.md`, `ee/122122025002.md`
- **Määrused** (`{globaalID}.md`) — dokumentLiik = määrus; konsolideeritud terviktekstid.

## Andmeallikas

- **Riigi Teataja (Eesti Vabariigi ametlik väljaanne)**
  - Portaal: https://www.riigiteataja.ee
  - Akti XML: https://www.riigiteataja.ee/akt/{globaalID}.xml
  - Avaandmed (aastased XML-arhiivid): https://www.riigiteataja.ee/avaandmed/ERT/xml.{YYYY}.zip

Failinimi on alati akti Riigi Teataja globaalID (nt 115052015002). Allikas pakub andmeid avaandmetena aastaste XML-arhiividena (xml.{YYYY}.zip), mida regenereeritakse iga päev. Andmekate algab vaikimisi aastast 2010; varasem sisu (enne 2010) on koondatud arhiivi xml.2010.zip. Pildid jäetakse teadlikult välja.

## Teised riigid

See repositoorium on osa projektist **Legalize**, mis haldab mitme riigi õigusakte git-repositooriumitena. Täielik kataloog on aadressil https://legalize.dev.

## Toetamine

Legalize on tasuta ja avatud. Kui sellest tööst on sulle kasu, saad aidata katta selle majutus- ja arenduskulusid: [Toeta seda projekti](https://buymeacoffee.com/legalizedev).

## Litsents

- **Pipeline'i kood**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Andmed**: avalik omand (ametlikud riiklikud väljaanded)
