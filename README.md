# Exam Generator (DocsDocs Klausurtrainer)

Statische Web-App (GitHub Pages), ohne Build.

## Daten
- `datasets/manifest.json` steuert die Datensätze im Dropdown.
- Pro Datensatz: `export.json` + optional `images.zip`.
- Zusätzlich je Datensatz: `notebookUrl` (NotebookLM-Link) im Manifest.

## Editor-Funktionen
- Stichwortsuche unterstützt mehrere Begriffe über `;` (z. B. `sql;join;index`).
- Sammelbearbeitung für Text über „Suchen & Ersetzen“ auf die aktuelle Trefferliste.
- Fragen können als „Fehlerhaft / wartungsbedürftig“ markiert werden.
- Optional kann eine Themenstruktur-Datei (2 Ebenen) geladen werden, damit Überthema/Unterthema als Vorschläge angezeigt werden.

Beispiel für Themenstruktur: `datasets/topic-tree.example.json`
```json
{ "subject": "Fach",
  "superTopics": [
    { "name": "Überthema", "subtopics": ["Unterthema A", "Unterthema B"] }
  ]
}
```

## Wichtige Hinweise
- Die App läuft komplett im Browser.
- Speicherung erfolgt lokal im Browser (localStorage) + optionaler Backup Export/Import.
