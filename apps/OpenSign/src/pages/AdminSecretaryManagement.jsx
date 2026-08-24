import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import Parse from "parse";
import Loader from "../primitives/Loader";

// Admin-only: grant/revoke a "secretary" (another internal org member)
// read-only visibility into a signer's incoming documents. Both accounts
// must be internal org members (contracts_Users) in the same tenant.
// Access is enforced server-side (assignsecretary/listsecretaryassignments/
// togglesecretaryassignment all reject non-admins) - the redirect below is
// just so a non-admin who guesses the URL doesn't land on a dead page.
function AdminSecretaryManagement() {
  const extClass =
    localStorage.getItem("Extand_Class") &&
    JSON.parse(localStorage.getItem("Extand_Class"));
  const userRole = extClass?.[0]?.UserRole || "contracts_User";
  const isAdmin =
    userRole === "contracts_Admin" || userRole === "contracts_OrgAdmin";

  const [secretaryEmail, setSecretaryEmail] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [assignments, setAssignments] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const loadAssignments = async () => {
    setIsLoading(true);
    setErrorMsg("");
    try {
      const res = await Parse.Cloud.run("listsecretaryassignments");
      setAssignments(res?.assignments || []);
    } catch (err) {
      setErrorMsg(err?.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAssign = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      await Parse.Cloud.run("assignsecretary", {
        secretaryEmail: secretaryEmail.trim(),
        signerEmail: signerEmail.trim()
      });
      setSuccessMsg("มอบหมายสำเร็จ");
      setSecretaryEmail("");
      setSignerEmail("");
      await loadAssignments();
    } catch (err) {
      setErrorMsg(err?.message || "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggle = async (assignmentId, field, nextValue) => {
    setErrorMsg("");
    try {
      const res = await Parse.Cloud.run("togglesecretaryassignment", {
        assignmentId,
        [field]: nextValue
      });
      setAssignments((prev) =>
        prev.map((a) =>
          a.objectId === assignmentId
            ? { ...a, isActive: res.isActive, canViewContent: res.canViewContent }
            : a
        )
      );
    } catch (err) {
      setErrorMsg(err?.message || "Something went wrong.");
    }
  };

  if (!isAdmin) {
    return <Navigate to="/dashboard/35KBoSgoAK" />;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto w-full">
      <h1 className="text-xl font-semibold mb-1">มอบหมาย Secretary</h1>
      <p className="text-sm text-base-content/60 mb-4">
        กำหนดให้พนักงานคนหนึ่งดูเอกสารขาเข้าของพนักงานอีกคนได้ (ดูอย่างเดียว ไม่สามารถเซ็นแทนได้)
      </p>

      <form
        onSubmit={handleAssign}
        className="flex flex-col md:flex-row gap-3 mb-2"
      >
        <input
          type="email"
          required
          placeholder="Email ของ Secretary"
          className="op-input op-input-bordered flex-1"
          value={secretaryEmail}
          onChange={(e) => setSecretaryEmail(e.target.value)}
        />
        <input
          type="email"
          required
          placeholder="Email ของผู้ลงนาม"
          className="op-input op-input-bordered flex-1"
          value={signerEmail}
          onChange={(e) => setSignerEmail(e.target.value)}
        />
        <button
          type="submit"
          className="op-btn op-btn-primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? "กำลังมอบหมาย..." : "มอบหมาย"}
        </button>
      </form>

      {errorMsg && (
        <div className="op-alert op-alert-error mb-4 text-sm">{errorMsg}</div>
      )}
      {successMsg && (
        <div className="op-alert op-alert-success mb-4 text-sm">
          {successMsg}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300 mt-4">
          <table className="op-table op-table-sm bg-base-100">
            <thead>
              <tr>
                <th>Secretary</th>
                <th>ผู้ลงนาม</th>
                <th>สร้างเมื่อ</th>
                <th>ดูรายการเอกสาร</th>
                <th>ดูเนื้อหาเอกสาร</th>
              </tr>
            </thead>
            <tbody>
              {assignments?.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-base-content/60 py-6">
                    ยังไม่มีการมอบหมาย
                  </td>
                </tr>
              )}
              {assignments?.map((a) => (
                <tr key={a.objectId}>
                  <td>
                    {a.secretary?.name}
                    <div className="text-xs text-base-content/50">
                      {a.secretary?.email}
                    </div>
                  </td>
                  <td>
                    {a.signer?.name}
                    <div className="text-xs text-base-content/50">
                      {a.signer?.email}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-sm">
                    {a.createdAt
                      ? new Date(a.createdAt).toLocaleDateString("th-TH")
                      : "-"}
                  </td>
                  <td>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="op-toggle op-toggle-success op-toggle-sm"
                        checked={a.isActive}
                        onChange={(e) =>
                          handleToggle(a.objectId, "isActive", e.target.checked)
                        }
                      />
                      <span className="text-xs">
                        {a.isActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                      </span>
                    </label>
                  </td>
                  <td>
                    <label
                      className={`flex items-center gap-2 ${
                        a.isActive ? "cursor-pointer" : "cursor-not-allowed opacity-40"
                      }`}
                      title={
                        a.isActive
                          ? ""
                          : "ต้องเปิดสิทธิ์ดูรายการเอกสารก่อน"
                      }
                    >
                      <input
                        type="checkbox"
                        className="op-toggle op-toggle-success op-toggle-sm"
                        checked={a.canViewContent}
                        disabled={!a.isActive}
                        onChange={(e) =>
                          handleToggle(a.objectId, "canViewContent", e.target.checked)
                        }
                      />
                      <span className="text-xs">
                        {a.canViewContent ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                      </span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AdminSecretaryManagement;
