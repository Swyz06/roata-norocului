# Roata Norocului — varianta finală pentru publicare

Această versiune folosește:
- Node.js + Express
- PostgreSQL online (prin `DATABASE_URL`)
- Cookie HTTP-only pentru identificarea participantului
- verificare server-side și constrângere `UNIQUE` în baza de date
- panou de administrator la `/admin`
- gestionare premii și câștigători
- export CSV
- rate limiting pentru endpointurile sensibile

## Variabile necesare

`DATABASE_URL` = URL-ul bazei PostgreSQL
`ADMIN_PASSWORD` = parola panoului de administrator
`SECRET` = un șir lung și aleatoriu folosit pentru semnarea tokenului admin

Nu pune aceste valori în cod și nu le urca pe GitHub.

## Publicare recomandată

Folosește un hosting Node.js care suportă variabile de mediu și o bază PostgreSQL persistentă. În hosting setezi:
- Build command: `npm install`
- Start command: `npm start`

Apoi adaugi cele 3 variabile de mediu de mai sus.

## Important despre "o singură dată"

Implementarea blochează a doua participare pentru același cookie/browser și verificarea se face pe server. Totuși, un cookie poate fi șters sau poate fi folosit alt dispozitiv/browser. Dacă regula concursului trebuie să fie strict "o persoană reală = o singură participare", folosește coduri unice de participare, autentificare sau verificare email/telefon.

## Înainte de lansare

1. Schimbă parola admin.
2. Generează un SECRET lung, aleatoriu.
3. Activează HTTPS la hosting.
4. Verifică premiile și ponderile din `/admin`.
5. Fă un test complet cu un browser normal și unul incognito.
6. Nu folosi date reale ale participanților fără să verifici obligațiile legale privind protecția datelor.
