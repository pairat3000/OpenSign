import { useState } from "react";
import { Navigate } from "react-router";
import Parse from "parse";
import Loader from "../primitives/Loader";

// Admin-only diagnostic tool: search a document creator's outgoing
// signature-request documents by email (+ optional document name) and see
// mail-send history, current status, Send-in-order setting, and a
// plain-language diagnosis of anything that looks wrong. Read-only - it
// does not resend mail itself, admins already have Resend on the document.
//
// Access is enforced server-side too (adminauditdocuments cloud function
// rejects non-admins) - this redirect is just so a non-admin who guesses
// the URL doesn't land on a page they can't use.
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
      <h1 className="text-xl font-semibold mb-4">
        ตรวจสอบความผิดปกติของการส่งเอกสาร (Admin)
      </h1>

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
        <button type="submit" className="op-btn op-btn-primary">
          ค้นหา
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

      {documents && documents.length === 0 && !isLoading && (
        <div className="text-base-content/70">ไม่พบเอกสารที่ตรงกับเงื่อนไข</div>
      )}

      <div className="flex flex-col gap-3">
        {documents?.map((doc) => (
          <div
            key={doc.objectId}
            className="border border-base-300 rounded-box overflow-hidden"
          >
            <button
              type="button"
              className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 justify-between p-4 text-left hover:bg-base-200"
              onClick={() =>
                setExpandedId(expandedId === doc.objectId ? null : doc.objectId)
              }
            >
              <span className="font-medium">{doc.name}</span>
              <span className="text-sm text-base-content/70">
                สถานะ: {doc.status}
              </span>
              <span className="text-sm text-base-content/70">
                Send in order: {doc.sendInOrder ? "Y" : "N"}
              </span>
            </button>

            {expandedId === doc.objectId && (
              <div className="p-4 border-t border-base-300 flex flex-col gap-4">
                <div>
                  <h3 className="font-medium mb-2">วิธีการแก้ไขหากผิดปกติ</h3>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {doc.diagnosis.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="font-medium mb-2">ประวัติการส่งอีเมล</h3>
                  {doc.mailLog.length === 0 ? (
                    <div className="text-sm text-base-content/70">
                      ยังไม่มีประวัติการส่งอีเมลสำหรับเอกสารนี้
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="op-table op-table-sm">
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
                              <td>{entry.Purpose}</td>
                              <td>
                                <span
                                  className={
                                    entry.Status === "success"
                                      ? "op-badge op-badge-success"
                                      : "op-badge op-badge-error"
                                  }
                                >
                                  {entry.Status}
                                </span>
                              </td>
                              <td>{entry.ErrorMessage || "-"}</td>
                              <td>
                                {entry.SentAt
                                  ? new Date(entry.SentAt).toLocaleString()
                                  : "-"}
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
        ))}
      </div>
    </div>
  );
}

export default AdminDocumentAudit;
