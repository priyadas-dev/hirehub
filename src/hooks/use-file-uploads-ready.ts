import { useQuery } from "@tanstack/react-query";
import { probeHireHubFileUploadsReady } from "@/lib/hirehub-storage";

/** True when PROPOSED_0008 columns are visible to the API (buckets expected to exist too). */
export function useFileUploadsReady() {
  return useQuery({
    queryKey: ["hirehub-file-uploads-ready"],
    queryFn: probeHireHubFileUploadsReady,
    staleTime: 60_000,
    retry: false,
  });
}
