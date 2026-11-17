# What to Watch

Sivusto, johon syötetään ikä, maa, omat suoratoistopalvelut ja fiilis. Se ehdottaa elokuvia ja sarjoja, jotka löytyvät oikeasti valituista palveluista kyseisessä maassa.

## Miten se toimii
1. Palvelin hakee TMDB:n rajapinnasta (JustWatchin data) palvelujen oikean tarjonnan käyttäjän maassa.
2. Claude (tekoälybotti) selaa tarjontaa työkaluilla ja valitsee sekä perustelee ehdotukset.
3. Palvelin tarkistaa jokaisen valinnan itse: kuuluuko se tilaukseen valituissa palveluissa, mahtuuko ikärajahaarukkaan, onko oikea laji, onko jo ehdotettu. Epäilyttävät pudotetaan pois. Claude ei voi lisätä sivulle mitään, mitä rajapinta ei vahvista.

## Kaksi tilaa
- **Ilman tekoälyä (ilmainen):** pelkkä TMDB-avain riittää. Palvelin selaa valittujen palvelujesi oikeaa tarjontaa, suodattaa iän, ikärajahaarukan, lajin ja fiiliksen mukaan ja arpoo eri sivuja, jotta tulokset vaihtelevat. Vapaata toivetekstiä ei huomioida.
- **Tekoälyn kanssa:** jos `ANTHROPIC_API_KEY` on asetettu, Claude valitsee ja perustelee ehdotukset ja ymmärtää vapaan toiveen. Maksullinen, käytön mukaan.

## Käyttöönotto
Tarvitset Node.js 20 tai uudemman. Ei riippuvuuksia, `npm install` ei tarvita.

1. TMDB-avain (ilmainen): themoviedb.org → tili → Settings → API.
2. (Valinnainen) Anthropic-avain: console.anthropic.com → API keys. Haut maksavat pienen summan per haku.
3. Kopioi `.env.example` nimelle `.env` ja liitä avaimet.
4. `node server.js` ja avaa http://localhost:3000

Julkaisuun käy mikä tahansa Node-palvelu (Render, Railway, Fly.io, oma VPS). Aseta avaimet ympäristömuuttujiksi, käynnistyskomento on `node server.js`. Älä koskaan laita avaimia selainpuolen tiedostoihin.

## Huomioita
- TMDB on ilmainen vain ei-kaupalliseen käyttöön. Kaupallinen käyttö vaatii heidän lisenssinsä. Tarkista ehdot itse.
- Rotten Tomatoesin arvosanaa ei ole saatavilla tästä rajapinnasta. Sivu näyttää TMDB-arvosanan ja IMDb-linkin.
- Haut on rajattu (oletus 6 / 10 min / IP ja 500 / vrk), jotta tekoälykulut eivät karkaa. Muutettavissa `.env`:ssä.
- Testattu feikkipalvelimilla (TMDB ja Claude), ei oikeilla avaimilla.
- Sivun alareunan JustWatch- ja TMDB-maininnat on pidettävä.
