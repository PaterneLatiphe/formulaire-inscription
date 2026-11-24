/**
 * Google Apps Script — Backend du formulaire d'inscription Concours d'entrepreneuriat
 * Déployer comme application web (doPost/doGet), exécution "Qui a accès à ce document" = moi.
 * Lier à une Google Sheets pour le stockage.
 */

const SHEET_ID = '1zQJCq6dOEvo71mS0w2laAYjevxgcvo_GAyQGINn4wYs'; // Google Sheets "Candidatures Concours"
const SHEET_NAME = 'Candidatures';
const RATE_LIMIT_WINDOW_MIN = 60; // fenêtre de rate limiting
const RATE_LIMIT_MAX = 10000000; // Sans limite pour le test
const HONEYPOT_FIELD = 'telephone_personnel'; // champ caché anti-spam

// Période d'inscription (à adapter selon votre config .env / contest)
const REGISTRATION_OPENS_AT = new Date('2026-11-01T00:00:00'); // Ouvert en permanence
const REGISTRATION_CLOSES_AT = new Date('2026-12-31T23:59:59'); // Ouvert en permanence

/**
 * doGet — retourne le statut d'ouverture du concours (pour le frontend).
 */
function doGet(e) {
  const event = e || {};
  const parameter = (event.parameter) || {};

  // Mode lecture des candidatures (action=get_candidates)
  if (parameter.action === 'get_candidates') {
    const result = getCandidates(event);
    return ContentService
      .createTextOutput(String(parameter.callback) + '(' + JSON.stringify(result) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // JSONP callback (pour contourner CORS)
  const callback = parameter.callback;
  if (callback) {
    // Traiter comme une soumission (meme logique que doPost)
    const result = processSubmission(event);
    return ContentService
      .createTextOutput(String(callback) + '(' + JSON.stringify(result) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  const ip = parameter.__ip || 'unknown';
  const now = new Date();
  const isOpen = now >= REGISTRATION_OPENS_AT && now <= REGISTRATION_CLOSES_AT;

  return ContentService
    .createTextOutput(JSON.stringify({
      open: isOpen,
      opens_at: REGISTRATION_OPENS_AT.toISOString(),
      closes_at: REGISTRATION_CLOSES_AT.toISOString(),
      message_fr: isOpen
        ? 'Les inscriptions sont ouvertes.'
        : now < REGISTRATION_OPENS_AT
          ? 'Les inscriptions ouvriront le 27 novembre.'
          : 'Les inscriptions sont closes depuis le 4 décembre.'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Fonction partagee pour traiter la soumission (appelee par doGet avec callback et doPost)
function processSubmission(e) {
  try {
    const safeE = e || {};
    const parameter = (safeE.parameter) || {};
    const ip = parameter.__ip || 'unknown';

    // 1. Honeypot
    if (parameter[HONEYPOT_FIELD] && String(parameter[HONEYPOT_FIELD]).trim() !== '') {
      return { status: 'ignored' };
    }

    // 2. Periode
    const now = new Date();
    if (now < REGISTRATION_OPENS_AT) {
      return { status: 'error', code: 'not_open', message_fr: 'Les inscriptions ouvriront le 27 novembre.' };
    }
    if (now > REGISTRATION_CLOSES_AT) {
      return { status: 'error', code: 'closed', message_fr: 'Les inscriptions sont closes depuis le 4 decembre.' };
    }

    // 3. Rate limiting
    const cache = CacheService.getScriptCache();
    const cacheKey = 'rate_' + ip;
    let history = [];
    try { history = JSON.parse(cache.get(cacheKey) || '[]'); } catch (_) { history = []; }
    const windowStart = now.getTime() - RATE_LIMIT_WINDOW_MIN * 60 * 1000;
    history = history.filter(function(t) { return t > windowStart; });
    if (history.length >= RATE_LIMIT_MAX) {
      return { status: 'error', code: 'rate_limited', message_fr: 'Trop de soumissions. Reessayez plus tard.' };
    }
    history.push(now.getTime());
    cache.put(cacheKey, JSON.stringify(history), RATE_LIMIT_WINDOW_MIN * 60);

    // 4. Telephone
    const rawPhone = String(parameter.telephone || '').replace(/[^0-9]/g, '');
    let phone = rawPhone.startsWith('226') && rawPhone.length === 11 ? rawPhone.substring(3) : rawPhone.substring(Math.max(0, rawPhone.length - 8));
    if (phone.length !== 8) {
      return { status: 'error', code: 'bad_phone', message_fr: 'Le numero doit avoir 8 chiffres.' };
    }
    const fullPhone = '226' + phone;

    // 5. Doublon
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const header = data[0];
    const phoneCol = header.indexOf('phone');
    if (phoneCol !== -1) {
      for (let r = 1; r < data.length; r++) {
        if (String(data[r][phoneCol]) === fullPhone) {
          return { status: 'error', code: 'duplicate_phone', message_fr: 'Ce numero est deja inscrit.' };
        }
      }
    }

    // 6. Reference
    const reference = generateReference(sheet);

    // 7. Ligne
    const row = [
      reference,
      String(parameter.last_name || ''),
      String(parameter.first_name || ''),
      String(parameter.gender || ''),
      String(parameter.birth_year || '') + '-' + String(parameter.birth_month || '').padStart(2, '0') + '-' + String(parameter.birth_day || '').padStart(2, '0'),
      fullPhone,
      String(parameter.whatsapp || ''),
      String(parameter.email || ''),
      String(parameter.arrondissement_id || ''),
      String(parameter.neighborhood || ''),
      String(parameter.institution || ''),
      String(parameter.level || ''),
      String(parameter.field_of_study || ''),
      String(parameter.youth_movement || ''),
      String(parameter.has_internet || ''),
      String(parameter.guardian_name || ''),
      String(parameter.guardian_phone || ''),
      String(parameter.guardian_consent || ''),
      String(parameter.data_consent || ''),
      String(parameter.rules_accepted || ''),
      '', '', 'recu', '', '',
      new Date(), ip
    ];

    if (data.length === 0 || (data.length === 1 && data[0].length === 0)) {
      sheet.appendRow(['reference','last_name','first_name','gender','birth_date','phone','whatsapp','email','arrondissement_id','neighborhood','institution','level','field_of_study','youth_movement','has_internet','guardian_name','guardian_phone','guardian_consent','data_consent','rules_accepted','is_eligible','eligibility_notes','selection_status','jury_score','jury_notes','created_at','source_ip']);
    }

    sheet.appendRow(row);

    return { status: 'ok', reference: reference, message_fr: 'Ton inscription est enregistree.' };

  } catch (err) {
    return { status: 'error', code: 'server', message_fr: 'Erreur technique. Reessayez.' };
  }
}

/**
 * doPost — reçoit la soumission du formulaire.
 */
function doPost(e) {
  const result = processSubmission(e);
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Lecture des candidatures — retourne toutes les lignes du Sheet ( pour l'export ).
 */
function getCandidates(e) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length === 0) { return { status: 'ok', rows: [] }; }
    const header = data[0];
    const cols = {
      reference: header.indexOf('reference'),
      last_name: header.indexOf('last_name'),
      first_name: header.indexOf('first_name'),
      gender: header.indexOf('gender'),
      birth_date: header.indexOf('birth_date'),
      phone: header.indexOf('phone'),
      whatsapp: header.indexOf('whatsapp'),
      email: header.indexOf('email'),
      arrondissement_id: header.indexOf('arrondissement_id'),
      institution: header.indexOf('institution'),
      level: header.indexOf('level'),
      field_of_study: header.indexOf('field_of_study'),
      youth_movement: header.indexOf('youth_movement'),
      has_internet: header.indexOf('has_internet'),
      guardian_name: header.indexOf('guardian_name'),
      guardian_phone: header.indexOf('guardian_phone'),
      created_at: header.indexOf('created_at'),
      selection_status: header.indexOf('selection_status')
    };
    const headerNames = header.map(function(h){ return h !== null && h !== '' ? String(h) : null; });
    const rows = [];
    for (let r = 1; r < data.length; r++) {
      const row = {};
      for (const key in cols) {
        const idx = cols[key];
        if (idx !== -1) { row[key] = data[r][idx] !== null ? String(data[r][idx]) : ''; }
      }
      rows.push(row);
    }
    return { status: 'ok', count: rows.length, header: headerNames, firstRow: data[1] ? data[1].map(function(c){ return c !== null ? String(c).slice(0, 40) : ''; }) : null, rows: rows };
  } catch (err) {
    return { status: 'error', message_fr: 'Erreur lecture. Reessayez.' };
  }
}

function generateReference(sheet) {
  const year = new Date().getFullYear().toString();
  let reference;
  let exists = true;
  while (exists) {
    reference = 'ENT-' + year + '-' + Math.floor(1000 + Math.random() * 9000);
    exists = false;
    const data = sheet.getDataRange().getValues();
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][0]) === reference) {
        exists = true;
        break;
      }
    }
  }
  return reference;
}
