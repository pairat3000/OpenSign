import { COMPLETION_ACTIVITIES, isCompletionRelevant } from '../../utils/workflowUtils.js';

// Builds a plain-language diagnosis of a document's send/sign state from
// its MailLog, AuditTrail, and Placeholders - read-only, no remediation
// action is taken here (admins already have Resend on the document itself).
function buildAuditEntry(doc) {
  const d = doc.toJSON();
  const placeholders = Array.isArray(d.Placeholders) ? d.Placeholders.filter(isCompletionRelevant) : [];
  const auditTrail = Array.isArray(d.AuditTrail) ? d.AuditTrail : [];
  const signedIds = new Set(
    auditTrail
      .filter(a => COMPLETION_ACTIVITIES.includes(a?.Activity))
      .map(a => a?.UserPtr?.objectId)
  );
  const viewedIds = new Set(
    auditTrail.filter(a => a?.Activity === 'Viewed' || a?.ViewedOn).map(a => a?.UserPtr?.objectId)
  );

  let status;
  let waitingOn = [];
  if (d.IsDeclined) {
    status = 'Declined';
  } else if (d.IsCompleted) {
    status = 'Completed';
  } else if (!d.SendMail) {
    status = 'Not yet sent';
  } else {
    status = 'In progress';
    waitingOn = placeholders
      .filter(p => !signedIds.has(p?.signerObjId || p?.signerPtr?.objectId))
      .map(p => p?.signerPtr?.Name || p?.signerObjId)
      .filter(Boolean);
  }

  // Per-signer breakdown, in placeholder order (= signing order when
  // SendinOrder is on) - drives the progress bar and the individual status
  // list in the UI.
  const declineByObjId = d.DeclineBy?.objectId;
  const signers = placeholders.map((p, idx) => {
    const signerObjId = p?.signerObjId || p?.signerPtr?.objectId;
    let signerStatus;
    if (d.IsDeclined && signerObjId && signerObjId === declineByObjId) {
      signerStatus = 'Declined';
    } else if (signedIds.has(signerObjId)) {
      signerStatus = 'Signed';
    } else if (viewedIds.has(signerObjId)) {
      signerStatus = 'Viewed';
    } else {
      signerStatus = 'Pending';
    }
    return {
      order: idx + 1,
      name: p?.signerPtr?.Name || signerObjId || `ผู้ลงนามคนที่ ${idx + 1}`,
      email: p?.signerPtr?.Email || '',
      status: signerStatus
    };
  });
  const signedCount = signers.filter(s => s.status === 'Signed').length;

  const mailLog = Array.isArray(d.MailLog) ? [...d.MailLog].reverse() : [];

  const diagnosis = [];
  mailLog.forEach(entry => {
    if (entry?.Status === 'error') {
      diagnosis.push(
        `ส่งอีเมลไปหา ${entry.Recipient} ไม่สำเร็จ (${entry.ErrorMessage || 'unknown error'}) — ลองกด Resend ที่หน้าเอกสาร`
      );
    }
  });
  placeholders.forEach(p => {
    const signerObjId = p?.signerObjId || p?.signerPtr?.objectId;
    const name = p?.signerPtr?.Name || signerObjId;
    const email = p?.signerPtr?.Email;
    const hasMailLog = mailLog.some(m => m?.Recipient === email);
    if (signerObjId && !signedIds.has(signerObjId) && !viewedIds.has(signerObjId) && !hasMailLog) {
      diagnosis.push(`ยังไม่เคยส่งอีเมลไปหา ${name} เลย`);
    }
  });
  if (d.SendinOrder) {
    let sawUnsigned = false;
    for (const p of placeholders) {
      const signerObjId = p?.signerObjId || p?.signerPtr?.objectId;
      const signed = signedIds.has(signerObjId);
      if (!signed) {
        sawUnsigned = true;
      } else if (sawUnsigned) {
        diagnosis.push('ลำดับการเซ็นดูผิดปกติสำหรับเอกสารที่เปิด Send in order');
        break;
      }
    }
  }
  if (diagnosis.length === 0) diagnosis.push('ไม่พบความผิดปกติ');

  return {
    objectId: d.objectId,
    name: d.Name,
    status,
    waitingOn,
    sendInOrder: !!d.SendinOrder,
    createdAt: d.createdAt,
    signers,
    signedCount,
    totalCount: signers.length,
    mailLog,
    diagnosis,
    hasIssue: diagnosis.length > 0 && diagnosis[0] !== 'ไม่พบความผิดปกติ',
  };
}

export default async function adminAuditDocuments(request) {
  const creatorEmail = (request.params.creatorEmail || '').trim().toLowerCase();
  const documentName = (request.params.documentName || '').trim();

  if (!creatorEmail) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Please provide creatorEmail.');
  }
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }

  const adminUserQuery = new Parse.Query('contracts_Users');
  adminUserQuery.equalTo('UserId', request.user);
  const adminUser = await adminUserQuery.first({ useMasterKey: true });
  const isAdmin =
    adminUser?.get('UserRole') === 'contracts_Admin' || adminUser?.get('UserRole') === 'contracts_OrgAdmin';
  if (!isAdmin) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
  }
  const tenantId = adminUser.get('TenantId');

  const creatorQuery = new Parse.Query('contracts_Users');
  creatorQuery.equalTo('Email', creatorEmail);
  if (tenantId) creatorQuery.equalTo('TenantId', tenantId);
  const creator = await creatorQuery.first({ useMasterKey: true });
  if (!creator) {
    return { documents: [] };
  }

  const docQuery = new Parse.Query('contracts_Document');
  docQuery.equalTo('ExtUserPtr', creator);
  if (documentName) {
    docQuery.matches('Name', documentName, 'i');
  }
  docQuery.include('Placeholders.signerPtr');
  docQuery.descending('createdAt');
  docQuery.limit(50);
  const docs = await docQuery.find({ useMasterKey: true });

  return { documents: docs.map(buildAuditEntry) };
}
