// One icon family (Phosphor), one stroke weight, everywhere.
import {
  ArrowRight,
  ArrowsLeftRight,
  CaretRight,
  ChatsCircle,
  Check,
  DownloadSimple,
  FileText,
  Microphone,
  PaperPlaneRight,
  Quotes,
  Scales,
  Square,
  Stack,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

type IconProps = {
  className?: string;
};

function make(Icon: typeof Check) {
  return function PhosphorIcon({ className }: IconProps) {
    return <Icon className={className} weight="light" aria-hidden="true" />;
  };
}

export const IconMark = make(Scales);
export const IconUpload = make(UploadSimple);
export const IconTrash = make(Trash);
export const IconQuote = make(Quotes);
export const IconSplit = make(ArrowsLeftRight);
export const IconStack = make(Stack);
export const IconSend = make(PaperPlaneRight);
export const IconStop = make(Square);
export const IconChevron = make(CaretRight);
export const IconCheck = make(Check);
export const IconAlert = make(WarningCircle);
export const IconFile = make(FileText);
export const IconClose = make(X);
export const IconArrow = make(ArrowRight);
export const IconChat = make(ChatsCircle);
export const IconMic = make(Microphone);
export const IconDownload = make(DownloadSimple);
