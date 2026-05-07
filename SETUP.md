# Symphony Shuttle — Setup

## 1. Google OAuth

1. Idi na https://console.developers.google.com/
2. Kreiraj novi projekat → **APIs & Services** → **Credentials**
3. **Create Credentials** → **OAuth 2.0 Client IDs** → Web application
4. Authorized redirect URIs: `http://localhost:3000/auth/google/callback`
   (za produkciju: `https://tvoj-domen.com/auth/google/callback`)
5. Kopiraj **Client ID** i **Client Secret** u `.env`

## 2. Web Push VAPID Keys

```bash
node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(JSON.stringify(k,null,2));"
```
Kopiraj `publicKey` → `VAPID_PUBLIC_KEY` i `privateKey` → `VAPID_PRIVATE_KEY` u `.env`.

## 3. Vozač konfiguracija

U `.env` dodaj email(e) vozača:
```
DRIVER_EMAILS=vozac@symphony.is,drugi.vozac@symphony.is
```
Vozač dobija poseban "Vozač" tab sa listom putnika i dijeljenje GPS lokacije.

## 4. Pokretanje

```bash
npm install
npm start
# ili za razvoj:
npm run dev
```

Otvori: http://localhost:3000

## 5. Produkcija

- Postavi `NODE_ENV=production` u `.env`
- Mijenjaj `SESSION_SECRET` na nasumičan string
- Dodaj HTTPS (nginx reverse proxy ili Cloudflare)
- Promijeni `GOOGLE_CALLBACK_URL` na produkcijski URL

## Funkcionalnosti

| Feature | Status |
|---------|--------|
| Google login (@symphony.is only) | ✅ |
| 4 ture sa tačnim stanicama | ✅ |
| Vizuelni prikaz 19 sjedišta | ✅ |
| Rezervacija sa odabirom stanice | ✅ |
| Real-time seat updates (Socket.io) | ✅ |
| Chat poruke vozaču | ✅ |
| Live GPS mapa (Leaflet + OpenStreetMap) | ✅ |
| Vozačev panel sa listom putnika | ✅ |
| Auto reset u ponoć | ✅ |
| Push notifikacija u 15:00 | ✅ |
| Mobile-first UI (dark mode) | ✅ |
