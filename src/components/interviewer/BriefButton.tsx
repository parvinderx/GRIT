"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { btnClass } from "@/components/student/ui/Button";
import { InterviewBrief, type BriefInfo } from "./InterviewBrief";

/** Row action that opens the interview brief in a dialog. */
export function BriefButton({ info, label }: { info: BriefInfo; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnClass("outline", "min-h-11 px-4 text-[15px]")}>
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="notebook block max-w-md rounded-xl bg-white p-6 sm:max-w-md">
          <InterviewBrief info={info} Title={DialogTitle} />
        </DialogContent>
      </Dialog>
    </>
  );
}
