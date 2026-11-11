# Trackday VL

Riepilogo dei turni auto e moto delle prove libere all'autodromo di Vallelunga: orari, posti liberi e prezzi, con il link per prenotare sul sito dell'autodromo.

Sito indipendente, non ufficiale e non affiliato ad ACI Vallelunga S.p.A.

- `index.html`: la pagina.
- `data.json`: i turni, riscritti in automatico.
- `scripts/update.mjs`: legge i turni dal calendario di Vallelunga.
- `.github/workflows/update.yml`: esegue l'aggiornamento ogni 15 minuti circa e pubblica il sito su GitHub Pages.
