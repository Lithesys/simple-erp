import { toast } from "react-toastify";

export function printPage() {
  if (typeof window === "undefined") return;
  if (!window.erpDesktop) {
    window.print();
    return;
  }

  void window.erpDesktop.printPage().then((result) => {
    if (!result.ok) throw new Error(result.message || "Printing failed.");
  }).catch((error: unknown) => {
    console.error("Desktop printing failed.", error);
    toast.error("Không thể in. Vui lòng kiểm tra máy in mặc định.");
  });
}
