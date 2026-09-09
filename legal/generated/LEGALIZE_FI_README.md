# legalize-fi

Suomi — lainsäädäntö Markdown-muodossa, versionhallittuna git-repositoriona.

Jokainen laki on tiedosto; jokainen uudistus on commit, joka on päivätty todelliseen viralliseen julkaisupäivään. Minkä tahansa lain `git log` näyttää sen koko historian — milloin se säädettiin, mitkä pykälät muuttuivat ja minkä normin nojalla.

Aineisto kattaa Suomen ajantasaisen (konsolidoidun) lainsäädännön Finlexin avoimen datan rajapinnasta. Jokainen säädös on yksi tiedosto ja jokainen muutos vastaa Git-committia, joka on päivätty viralliseen voimaantulopäivään. Tunnisteet noudattavat muotoa {vuosi}-{numero}.

## Sisältö

- **Laki** (`{vuosi}-{numero}.md`) — `fi/1999-731.md`, `fi/2024-224.md`
- **Asetus** (`{vuosi}-{numero}.md`) — `fi/2025-51.md`
- **Valtioneuvoston asetus** (`{vuosi}-{numero}.md`) — Finlexin tyyppi 'government-decree'.
- **Ministeriön asetus** (`{vuosi}-{numero}.md`) — Finlexin tyyppi 'ministerial-decree'.
- **Tasavallan presidentin asetus** (`{vuosi}-{numero}.md`) — Finlexin tyyppi 'presidential-decree'.
- **Määräys** (`{vuosi}-{numero}.md`) — Finlexin tyyppi 'order'.

## Tietolähde

- **Finlex — Suomen säädöskokoelman ajantasainen lainsäädäntö (oikeusministeriö, Oikeusrekisterikeskus)**
  - Portaali: https://www.finlex.fi
  - Avoin data (API): https://opendata.finlex.fi/finlex/avoindata/v1
  - API-dokumentaatio (Swagger): https://opendata.finlex.fi/swagger-ui/index.html
  - Avoimen datan tiedot: https://www.finlex.fi/fi/avoin-data

## Lähdeviittaus

> Sisältää Finlexin aineistoa, jonka on julkaissut oikeusministeriö (Oikeusrekisterikeskus). Aineisto on lisensoitu Creative Commons Nimeä 4.0 Kansainvälinen (CC BY 4.0) -lisenssillä: https://creativecommons.org/licenses/by/4.0/deed.fi. Aineistoon on tehty muotomuutoksia (XML-muoto muunnettu Markdowniksi).

## Huomioita

- Aineisto perustuu Finlexin tarjoamaan suomenkieliseen (fin) konsolidoituun ilmaisuun. Kaksikielisten säädösten ruotsinkielisiä (swe) versioita ei sisällytetä.
- Lähde julkaisee säädökset Akoma Ntoso 3.0 -XML-muodossa; pipeline muuntaa ne Markdowniksi.
- Kuvat jätetään pois (binääriaineistoa ei tueta); pois jätettyjen kuvien määrä kirjataan kenttään extra.images_dropped.

## Muut maat

Tämä repositorio on osa **Legalize**-hanketta, joka ylläpitää useiden maiden lainsäädäntöä git-repositorioina. Koko luettelo löytyy osoitteesta https://legalize.dev.

## Tue hanketta

Legalize on ilmainen ja avoin. Jos tästä työstä on sinulle hyötyä, voit auttaa kattamaan sen ylläpidon ja kehityksen kustannuksia: [Tue tätä hanketta](https://buymeacoffee.com/legalizedev).

## Lisenssi

- **Pipeline-koodi**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Tiedot**: Creative Commons Nimeä 4.0 Kansainvälinen (CC BY 4.0)
