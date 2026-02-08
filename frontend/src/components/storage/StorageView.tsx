import { forwardRef } from "react";
import type { Ref } from "react";
import type { StorageViewProps, StorageViewHandle } from "./types";
import StorageWorkspace from "./StorageWorkspace";

export default forwardRef(function StorageView(
  props: StorageViewProps,
  ref: Ref<StorageViewHandle>
) {
  return <StorageWorkspace {...props} ref={ref} />;
});
