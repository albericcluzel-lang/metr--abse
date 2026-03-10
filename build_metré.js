const ExcelJS = require('exceljs');
const path = require('path');

const wb = new ExcelJS.Workbook();
wb.creator = 'ABSE';

// ─── Palette ──────────────────────────────────────────────────────────────
const ANTHRACITE  = 'FF2D3436';
const BLANC       = 'FFFFFFFF';
const BLEU        = 'FF0984E3';
const BLEU_CLAIR  = 'FFDFE6E9';
const GRIS_CLAIR  = 'FFF5F6FA';
const GRIS_TEXTE  = 'FF636E72';
const BORDURE     = 'FFBDBDBD';

function thinBorder() {
  const s = { style: 'thin', color: { argb: BORDURE } };
  return { top: s, left: s, bottom: s, right: s };
}

function styleHeader(cell, text) {
  cell.value = text;
  cell.font      = { name: 'Arial', bold: true, color: { argb: BLANC }, size: 11 };
  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: ANTHRACITE } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border    = thinBorder();
}

function styleData(cell, bg = BLANC) {
  cell.font      = { name: 'Arial', size: 10 };
  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.border    = thinBorder();
}

// ════════════════════════════════════════════════════════════════════════════
// FEUILLE 1 : Saisie
// ════════════════════════════════════════════════════════════════════════════
const ws1 = wb.addWorksheet('Saisie');
ws1.getRow(1).height = 35;

// Largeurs colonnes visibles
ws1.getColumn('A').width = 30;
ws1.getColumn('B').width = 16;
ws1.getColumn('C').width = 16;

// En-têtes visibles
styleHeader(ws1.getCell('A1'), "Type d'ouvrage");
styleHeader(ws1.getCell('B1'), 'Surface (m²)');
styleHeader(ws1.getCell('C1'), 'Hauteur (m)');

// En-têtes colonnes auxiliaires (D–M)
const auxCols  = ['D','E','F','G','H','I','J','K','L','M'];
const auxNames = ['Longueur','Plaques','Isolant','Rails H','Lisses H',
                  'Montants V','Fourrures V','Fourrures P','Appuis','Suspentes'];
auxCols.forEach((col, i) => {
  ws1.getCell(`${col}1`).value = auxNames[i];
  ws1.getColumn(col).width = 14;
});

// Dropdown validation
ws1.dataValidations.add('A2:A21', {
  type: 'list',
  allowBlank: true,
  formulae: ['"Cloison,Cloison Double Peau,Doublage Optima,Plafond F530"'],
  showErrorMessage: true,
  errorStyle: 'error',
  errorTitle: 'Valeur invalide',
  error: 'Choisissez un type parmi la liste.'
});

// Lignes de saisie + formules auxiliaires
for (let r = 2; r <= 21; r++) {
  const bg = r % 2 === 0 ? GRIS_CLAIR : BLANC;

  styleData(ws1.getCell(`A${r}`), bg);
  styleData(ws1.getCell(`B${r}`), bg);
  styleData(ws1.getCell(`C${r}`), bg);
  ws1.getCell(`B${r}`).numFmt = '0.00';
  ws1.getCell(`C${r}`).numFmt = '0.00';

  // Col D – Longueur
  ws1.getCell(`D${r}`).value = {
    formula: `IF(OR(A${r}="Cloison",A${r}="Cloison Double Peau",A${r}="Doublage Optima"),IF(AND(C${r}<>"",C${r}>0),B${r}/C${r},0),0)`
  };

  // Col E – Plaques de plâtre
  ws1.getCell(`E${r}`).value = {
    formula: `IF(A${r}="Cloison",B${r}*2,IF(A${r}="Cloison Double Peau",B${r}*4,IF(OR(A${r}="Doublage Optima",A${r}="Plafond F530"),B${r},0)))`
  };

  // Col F – Isolant
  ws1.getCell(`F${r}`).value = {
    formula: `IF(OR(A${r}="Cloison",A${r}="Cloison Double Peau",A${r}="Doublage Optima",A${r}="Plafond F530"),B${r},0)`
  };

  // Col G – Rails horizontaux (Cloison / CDP)
  ws1.getCell(`G${r}`).value = {
    formula: `IF(OR(A${r}="Cloison",A${r}="Cloison Double Peau"),D${r}*2,0)`
  };

  // Col H – Lisses horizontales (Doublage Optima)
  ws1.getCell(`H${r}`).value = {
    formula: `IF(A${r}="Doublage Optima",D${r}*2,0)`
  };

  // Col I – Montants verticaux (Cloison / CDP)
  ws1.getCell(`I${r}`).value = {
    formula: `IF(OR(A${r}="Cloison",A${r}="Cloison Double Peau"),(ROUNDUP(D${r}/0.6,0)+1)*C${r},0)`
  };

  // Col J – Fourrures verticales (Doublage Optima)
  ws1.getCell(`J${r}`).value = {
    formula: `IF(A${r}="Doublage Optima",(ROUNDUP(D${r}/0.6,0)+1)*C${r},0)`
  };

  // Col K – Fourrures plafond (Plafond F530)
  ws1.getCell(`K${r}`).value = {
    formula: `IF(A${r}="Plafond F530",B${r}*3,0)`
  };

  // Col L – Appuis Optima
  ws1.getCell(`L${r}`).value = {
    formula: `IF(A${r}="Doublage Optima",B${r}*1.5,0)`
  };

  // Col M – Suspentes
  ws1.getCell(`M${r}`).value = {
    formula: `IF(A${r}="Plafond F530",B${r}*1.8,0)`
  };

  // Format numérique des colonnes auxiliaires
  ['D','E','F','G','H','I','J','K','L','M'].forEach(col => {
    ws1.getCell(`${col}${r}`).numFmt = '0.00';
  });
}

// Masquer colonnes auxiliaires D–M
['D','E','F','G','H','I','J','K','L','M'].forEach(col => {
  ws1.getColumn(col).hidden = true;
});

// Figer ligne d'en-tête
ws1.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];


// ════════════════════════════════════════════════════════════════════════════
// FEUILLE 2 : Résultats
// ════════════════════════════════════════════════════════════════════════════
const ws2 = wb.addWorksheet('Résultats');

ws2.getColumn('A').width = 30;
ws2.getColumn('B').width = 20;
ws2.getColumn('C').width = 12;

// Ligne 1 : Titre fusionné
ws2.mergeCells('A1:C1');
const titre = ws2.getCell('A1');
titre.value     = 'RÉCAPITULATIF DES MATÉRIAUX — ABSE';
titre.font      = { name: 'Arial', bold: true, size: 16, color: { argb: BLEU } };
titre.alignment = { horizontal: 'center', vertical: 'middle' };
ws2.getRow(1).height = 40;

// Ligne 2 : Note
ws2.mergeCells('A2:C2');
const note = ws2.getCell('A2');
note.value     = 'Quantités calculées avec +5% de chutes inclus';
note.font      = { name: 'Arial', italic: true, size: 10, color: { argb: GRIS_TEXTE } };
note.alignment = { horizontal: 'center', vertical: 'middle' };
ws2.getRow(2).height = 22;

// Ligne 3 vide
ws2.getRow(3).height = 8;

// Ligne 4 : En-têtes
styleHeader(ws2.getCell('A4'), 'Matériau');
styleHeader(ws2.getCell('B4'), 'Quantité (+5%)');
styleHeader(ws2.getCell('C4'), 'Unité');
ws2.getRow(4).height = 30;

// Matériaux
const materiaux = [
  { label: 'Plaques de plâtre',    col: 'E', unit: 'm²'     },
  { label: 'Isolant',              col: 'F', unit: 'm²'     },
  { label: 'Rails horizontaux',    col: 'G', unit: 'ml'     },
  { label: 'Lisses horizontales',  col: 'H', unit: 'ml'     },
  { label: 'Montants verticaux',   col: 'I', unit: 'ml'     },
  { label: 'Fourrures verticales', col: 'J', unit: 'ml'     },
  { label: 'Fourrures plafond',    col: 'K', unit: 'ml'     },
  { label: 'Appuis Optima',        col: 'L', unit: 'unités' },
  { label: 'Suspentes',            col: 'M', unit: 'unités' },
];

materiaux.forEach(({ label, col, unit }, idx) => {
  const row = 5 + idx;
  const bg  = idx % 2 === 0 ? BLEU_CLAIR : BLANC;

  // Colonne A – Label
  const cellA = ws2.getCell(`A${row}`);
  cellA.value     = label;
  cellA.font      = { name: 'Arial', size: 10 };
  cellA.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cellA.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  cellA.border    = thinBorder();

  // Colonne B – Quantité (formule)
  const cellB = ws2.getCell(`B${row}`);
  cellB.value  = { formula: `ROUND(SUM(Saisie!${col}2:${col}21)*1.05,2)` };
  cellB.font   = { name: 'Arial', size: 12, bold: true, color: { argb: BLEU } };
  cellB.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLEU_CLAIR } };
  cellB.alignment = { horizontal: 'center', vertical: 'middle' };
  cellB.border    = thinBorder();
  cellB.numFmt    = '0.00';

  // Colonne C – Unité
  const cellC = ws2.getCell(`C${row}`);
  cellC.value     = unit;
  cellC.font      = { name: 'Arial', size: 10, italic: true };
  cellC.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cellC.alignment = { horizontal: 'center', vertical: 'middle' };
  cellC.border    = thinBorder();

  ws2.getRow(row).height = 28;
});

// ─── Sauvegarde ─────────────────────────────────────────────────────────────
const output = path.join('C:\\Dev\\commade placo', 'Metré_ABSE.xlsx');
wb.xlsx.writeFile(output).then(() => {
  console.log(`✓ Fichier créé : ${output}`);
}).catch(err => {
  console.error('Erreur :', err);
  process.exit(1);
});
