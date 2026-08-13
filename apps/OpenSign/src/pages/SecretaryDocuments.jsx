import { useEffect, useState } from "react";
import Parse from "parse";
import Loader from "../primitives/Loader";

const STATUS_LABEL_TH = {
  Signed: "เซ็นแล้ว",
  Pending: "รอเซ็น",
  Declined: "ปฏิเสธการเซ็น"
};

const STATUS_BADGE = {
  Signed: "op-badge-success",
  Pending: "op-badge-warning",
  Declined: "op-badge-error"
};

// Shown to every logged-in user (not admin-gated) - if they have no active
// secretary assignments, listmysecretarysigners just returns an empty
// list and the page shows a friendly empty state instead of fetching
// nothing useful for most users.
function SecretaryDocuments() {
  const [signers, setSigners] = useState(null);
  const [selectedSignerId, setSelectedSignerId] = useState("");
  const [documents, setDocuments] = useState(null);
  const [isLoadingSigners, setIsLoadingSigners] = useState(true);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [viewingDoc, setViewingDoc] = useState(null); // { objectId, name, url }
  const [isLoadingView, setIsLoadingView] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await Parse.Cloud.run("listmysecretarysigners");
        const list = res?.signers || [];
        setSigners(list);
        if (list.length > 0) setSelectedSignerId(list[0].objectId);
      } catch (err) {
        setErrorMsg(err?.message || "Something went wrong.");
      } finally {
        setIsLoadingSigners(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedSignerId) return;
    (async () => {
      setIsLoadingDocs(true);
      setErrorMsg("");
      setDocuments(null);
      try {
        const res = await Parse.Cloud.run("getsecretarydocuments", {
          signerUserId: selectedSignerId
        });
        setDocuments(res?.documents || []);
      } catch (err) {
        setErrorMsg(err?.message || "Something went wrong.");
      } finally {
        setIsLoadingDocs(false);
      }
    })();
  }, [selectedSignerId]);

  const handleView = async (docId) => {
    setIsLoadingView(true);
    setErrorMsg("");
    try {
      const res = await Parse.Cloud.run("getsecretarydocumentdetail", {
        docId
      });
      setViewingDoc(res);
    } catch (err) {
      setErrorMsg(err?.message || "Something went wrong.");
    } finally {
      setIsLoadingView(false);
    }
  };

  if (isLoadingSigners) {
    return (
      <div className="flex justify-center py-16">
        <Loader />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto w-full">
      <h1 className="text-xl font-semibold mb-1">เอกสารที่ฉันดูแลในฐานะ Secretary</h1>
      <p className="text-sm text-base-content/60 mb-4">
        ดูสถานะและเนื้อหาเอกสารของผู้ที่มอบหมายให้คุณดูแล (ดูอย่างเดียว ไม่สามารถเซ็นแทนได้)
      </p>

      {errorMsg && (
        <div className="op-alert op-alert-error mb-4 text-sm">{errorMsg}</div>
      )}

      {signers?.length === 0 ? (
        <div className="text-base-content/70 py-6 text-center border border-dashed border-base-300 rounded-box">
          คุณยังไม่ได้รับมอบหมายให้ดูแลเอกสารของใคร
        </div>
      ) : (
        <>
          <div className="mb-4">
            <select
              className="op-select op-select-bordered w-full md:w-80"
              value={selectedSignerId}
              onChange={(e) => setSelectedSignerId(e.target.value)}
            >
              {signers?.map((s) => (
                <option key={s.objectId} value={s.objectId}>
                  {s.name} ({s.email})
                </option>
              ))}
            </select>
          </div>

          {isLoadingDocs ? (
            <div className="flex justify-center py-10">
              <Loader />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-box border border-base-300">
              <table className="op-table op-table-sm bg-base-100">
                <thead>
                  <tr>
                    <th>ชื่อเอกสาร</th>
                    <th>สถานะ</th>
                    <th>วันที่ส่ง</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {documents?.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-base-content/60 py-6">
                        ไม่มีเอกสาร
                      </td>
                    </tr>
                  )}
                  {documents?.map((doc) => (
                    <tr key={doc.objectId}>
                      <td>{doc.name}</td>
                      <td>
                        <span
                          className={`op-badge op-badge-sm ${STATUS_BADGE[doc.status] || "op-badge-ghost"}`}
                        >
                          {STATUS_LABEL_TH[doc.status] || doc.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-sm">
                        {doc.sentAt
                          ? new Date(doc.sentAt).toLocaleDateString("th-TH")
                          : "-"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="op-btn op-btn-sm op-btn-outline"
                          onClick={() => handleView(doc.objectId)}
                          disabled={isLoadingView}
                        >
                          ดูเอกสาร
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {viewingDoc && (
        <div
          className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setViewingDoc(null)}
        >
          <div
            className="bg-base-100 rounded-box w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-base-300">
              <span className="font-medium truncate">{viewingDoc.name}</span>
              <button
                type="button"
                className="op-btn op-btn-sm op-btn-ghost"
                onClick={() => setViewingDoc(null)}
              >
                ✕ ปิด
              </button>
            </div>
            <iframe
              title={viewingDoc.name}
              src={viewingDoc.url}
              className="flex-1 w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default SecretaryDocuments;
