# Julkaisu ilmaiseksi (Render)

1. Tee ilmainen tili: github.com ja render.com (kirjaudu Renderiin GitHubilla).
2. TMDB-avain: themoviedb.org → Settings → API. Valitse ei-kaupallinen käyttö.
3. GitHub: New repository → nimi `what-to-watch` → Create. Paina "uploading an existing file" ja vedä tähän kansion KAIKKI tiedostot (public-kansio mukaan). Paina Commit changes.
   Älä lataa .env-tiedostoa. .gitignore estää sen joka tapauksessa.
4. Render: New → Blueprint → valitse repository → Apply.
   (Vaihtoehto: New → Web Service, Build `npm install`, Start `node server.js`, Instance Type Free.)
5. Kun Render kysyy `TMDB_API_KEY`, liitä avain. Älä aseta ANTHROPIC_API_KEY:tä, jos haluat ilmaisen tilan.
6. Odota tilaa Live. Osoite on muotoa jotain.onrender.com.

Ilmainen palvelu menee uneen 15 min käyttämättömyyden jälkeen, ja ensimmäinen haku herättää sen (noin minuutti).
