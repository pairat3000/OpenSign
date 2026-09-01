import { useState } from "react";
import { Navigate } from "react-router";
import Parse from "parse";
import Loader from "../primitives/Loader";

// Admin-only diagnostic tool: search a document creator's outgoing
// signature-request documents by email (+ optional document name) and see
// mail-send history, current status, Send-in-order setting, per-signer
// progress, and a plain-language diagnosis of anything that looks wrong.
// Read-only - it does not resend mail itself, admins already have Resend on
// the document.
//
// Access is enforced server-side too (adminauditdocuments cloud function
// rejects non-admins) - this redirect is just so a non-admin who guesses
// the URL doesn't land on a page they can't use.

const STATUS_STYLES = {
  Completed: "op-badge-success",
  Declined: "op-badge-error",
  "Not yet sent": "op-badge-ghost",
  "In progress": "op-badge-warning"
};

const STATUS_LABEL_TH = {
  Completed: "เสร็จสมบูรณ์",
  Declined: "ปฏิเสธการเซ็น",
  "Not yet sent": "ยังไม่ได้ส่ง",
  "In progress": "กำลังดำเนินการ"
};

const PROGRESS_STYLES = {
  Completed: "op-progress-success",
  Declined: "op-progress-error",
  "Not yet sent": "",
  "In progress": "op-progress-warning"
};

const SIGNER_STATUS = {
  Signed: { icon: "✅", label: "ลงนามแล้ว", badge: "op-badge-success" },
  Viewed: { icon: "👁️", label: "เปิดดูแล้ว รอลงนาม", badge: "op-badge-info" },
  Pending: { icon: "⏳", label: "ยังไม่ได้เปิดดู", badge: "op-badge-ghost" },
  Declined: { icon: "❌", label: "ปฏิเสธการเซ็น", badge: "op-badge-error" }
};

const PURPOSE_LABEL_TH = {
  invite: "คำเชิญ",
  resend: "ส่งซ้ำ (Resend)",
  "next-signer-notify": "แจ้งเตือนคนถัดไป",
  "owner-notify": "แจ้งเจ้าของเอกสาร",
  completion: "อีเมลตอนเสร็จ"
};

function formatDateTh(dateStr) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function AdminDocumentAudit() {
  const extClass =
    localStorage.getItem("Extand_Class") &&
    JSON.parse(localStorage.getItem("Extand_Class"));
  const userRole = extClass?.[0]?.UserRole || "contracts_User";
  const isAdmin =
    userRole === "contracts_Admin" || userRole === "contracts_OrgAdmin";

  const [creatorEmail, setCreatorEmail] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documents, setDocuments] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!creatorEmail.trim()) return;
    setIsLoading(true);
    setErrorMsg("");
    setDocuments(null);
    setExpandedId(null);
    try {
      const res = await Parse.Cloud.run("adminauditdocuments", {
        creatorEmail: creatorEmail.trim(),
        documentName: documentName.trim()
      });
      setDocuments(res?.documents || []);
    } catch (err) {
      setErrorMsg(err?.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAdmin) {
    return <Navigate to="/dashboard/35KBoSgoAK" />;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto w-full">
      <h1 className="text-xl font-semibold mb-1">
        ตรวจสอบความผิดปกติของการส่งเอกสาร
      </h1>
      <p className="text-sm text-base-content/60 mb-4">
        ค้นหาด้วยอีเมลของผู้สร้างเอกสาร เพื่อดูสถานะและประวัติการส่งอีเมลของเอกสารนั้นๆ
      </p>

      <form
        onSubmit={handleSearch}
        className="flex flex-col md:flex-row gap-3 mb-6"
      >
        <input
          type="email"
          required
          placeholder="Email ของผู้สร้างเอกสาร"
          className="op-input op-input-bordered flex-1"
          value={creatorEmail}
          onChange={(e) => setCreatorEmail(e.target.value)}
        />
        <input
          type="text"
          placeholder="ชื่อเอกสาร (ไม่ระบุก็ได้)"
          className="op-input op-input-bordered flex-1"
          value={documentName}
          onChange={(e) => setDocumentName(e.target.value)}
        />
        <button
          type="submit"
          className="op-btn op-btn-primary"
          disabled={isLoading}
        >
          {isLoading ? "กำลังค้นหา..." : "ค้นหา"}
        </button>
      </form>

      {isLoading && (
        <div className="flex justify-center py-10">
          <Loader />
        </div>
      )}

      {errorMsg && (
        <div className="op-alert op-alert-error mb-4 text-sm">{errorMsg}</div>
      )}

      {documents && !isLoading && (
        <div className="text-sm text-base-content/60 mb-2">
          พบ {documents.length} เอกสาร
        </div>
      )}

      {documents && documents.length === 0 && !isLoading && (
        <div className="text-base-content/70 py-6 text-center border border-dashed border-base-300 rounded-box">
          ไม่พบเอกสารที่ตรงกับเงื่อนไข
        </div>
      )}

      <div className="flex flex-col gap-3">
        {documents?.map((doc) => {
          const isOpen = expandedId === doc.objectId;
          const total = doc.totalCount ?? doc.signers?.length ?? 0;
          const signed = doc.signedCount ?? 0;
          return (
            <div
              key={doc.objectId}
              className="border border-base-300 rounded-box overflow-hidden bg-base-100 shadow-sm"
            >
              <button
                type="button"
                className="w-full flex items-start gap-3 p-4 text-left hover:bg-base-200"
                onClick={() => setExpandedId(isOpen ? null : doc.objectId)}
              >
                <span className="mt-1 text-base-content/50">
                  {isOpen ? "▾" : "▸"}
                </span>
                <span
                  className="mt-1 text-lg leading-none"
                  title={doc.hasIssue ? "พบความผิดปกติ" : "ไม่พบความผิดปกติ"}
                >
                  {doc.hasIssue ? "⚠️" : "✅"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium truncate">{doc.name}</span>
                    <span
                      className={`op-badge op-badge-sm ${STATUS_STYLES[doc.status] || "op-badge-ghost"}`}
                    >
                      {STATUS_LABEL_TH[doc.status] || doc.status}
                    </span>
                    <span
                      className="op-badge op-badge-sm op-badge-outline"
                      title={
                        doc.sendInOrder
                          ? "ผู้ลงนามต้องเซ็นตามลำดับที่กำหนด"
                          : "ผู้ลงนามเซ็นตามลำดับไหนก่อนก็ได้"
                      }
                    >
                      {doc.sendInOrder ? "🔢 ตามลำดับ" : "🔀 ไม่จำกัดลำดับ"}
                    </span>
                  </div>

                  {total > 0 && (
                    <div className="flex items-center gap-2 mt-2 max-w-sm">
                      <progress
                        className={`op-progress ${PROGRESS_STYLES[doc.status] || ""} w-full h-2`}
                        value={signed}
                        max={total}
                      />
                      <span className="text-xs text-base-content/60 whitespace-nowrap">
                        {signed}/{total} คน
                      </span>
                    </div>
                  )}

                  <div className="text-xs text-base-content/50 mt-1">
                    สร้างเมื่อ {formatDateTh(doc.createdAt)}
                  </div>
                  {doc.waitingOn?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span className="text-xs text-base-content/60 mr-1">
                        รอลงนามจาก:
                      </span>
                      {doc.waitingOn.map((name, i) => (
                        <span
                          key={i}
                          className="op-badge op-badge-sm op-badge-outline"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="p-4 border-t border-base-300 flex flex-col gap-4 bg-base-200/40">
                  <div>
                    <h3 className="font-medium mb-2 text-sm">
                      วิธีการแก้ไขหากผิดปกติ
                    </h3>
                    <ul className="text-sm space-y-1.5">
                      {doc.diagnosis.map((line, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span>{line === "ไม่พบความผิดปกติ" ? "✅" : "⚠️"}</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {doc.signers?.length > 0 && (
                    <div>
                      <h3 className="font-medium mb-2 text-sm">
                        รายชื่อผู้ลงนาม{doc.sendInOrder ? " (ตามลำดับ)" : ""}
                      </h3>
                      <ul className="flex flex-col gap-1.5">
                        {doc.signers.map((s) => {
                          const info = SIGNER_STATUS[s.status] || SIGNER_STATUS.Pending;
                          return (
                            <li
                              key={s.order}
                              className="flex items-center gap-2 text-sm bg-base-100 border border-base-300 rounded-box px-3 py-2"
                            >
                              {doc.sendInOrder && (
                                <span className="op-badge op-badge-sm op-badge-neutral shrink-0">
                                  {s.order}
                                </span>
                              )}
                              <span className="text-base leading-none shrink-0">
                                {info.icon}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="font-medium truncate block">
                                  {s.name}
                                </span>
                                {s.email && (
                                  <span className="text-xs text-base-content/50 truncate block">
                                    {s.email}
                                  </span>
                                )}
                              </span>
                              <span
                                className={`op-badge op-badge-sm ${info.badge} shrink-0`}
                              >
                                {info.label}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  <div>
                    <h3 className="font-medium mb-2 text-sm">
                      ประวัติการส่งอีเมล
                    </h3>
                    {doc.mailLog.length === 0 ? (
                      <div className="text-sm text-base-content/70">
                        ยังไม่มีประวัติการส่งอีเมลสำหรับเอกสารนี้
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-box border border-base-300">
                        <table className="op-table op-table-sm bg-base-100">
                          <thead>
                            <tr>
                              <th>ผู้รับ</th>
                              <th>ประเภท</th>
                              <th>สถานะ</th>
                              <th>ข้อความ error</th>
                              <th>เวลา</th>
                            </tr>
                          </thead>
                          <tbody>
                            {doc.mailLog.map((entry, i) => (
                              <tr key={i}>
                                <td>{entry.Recipient}</td>
                                <td>{PURPOSE_LABEL_TH[entry.Purpose] || entry.Purpose}</td>
                                <td>
                                  <span
                                    className={
                                      entry.Status === "success"
                                        ? "op-badge op-badge-sm op-badge-success"
                                        : "op-badge op-badge-sm op-badge-error"
                                    }
                                  >
                                    {entry.Status === "success" ? "สำเร็จ" : "ล้มเหลว"}
                                  </span>
                                </td>
                                <td>{entry.ErrorMessage || "-"}</td>
                                <td className="whitespace-nowrap">
                                  {formatDateTh(entry.SentAt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AdminDocumentAudit;
