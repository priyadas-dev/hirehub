import type { JobCorpusCategory } from "@/lib/ai/corpus";
import type { LabeledJobExample } from "@/lib/ai/job-classifier";

/**
 * Fixed wording written outside `generateSyntheticJobCorpus`.
 * One row per category. Titles and skill stamps from the generator lists are not reused.
 * The classifier trains on the synthetic split and scores this list separately.
 */
export const ORIGINAL_JOB_DESCRIPTIONS: readonly LabeledJobExample[] = [
  {
    id: "original-engineering",
    category: "engineering" satisfies JobCorpusCategory,
    title: "Night-shift reliability steward",
    description:
      "When the holiday rush hits, this person watches the checkout service, writes what failed, and agrees a rollback with the shop crew.",
  },
  {
    id: "original-data",
    category: "data",
    title: "Weekly figures explainer",
    description:
      "They read yesterday's counter totals, circle an unusual swing, and tell the floor lead what changed.",
  },
  {
    id: "original-design",
    category: "design",
    title: "Community paper arranger",
    description:
      "They place photos and headlines on a page for a neighborhood paper and try pencil sketches before the final sheet.",
  },
  {
    id: "original-product",
    category: "product",
    title: "Next-month list keeper",
    description:
      "They write which request the corner shop should ship next and which one can wait.",
  },
  {
    id: "original-marketing",
    category: "marketing",
    title: "Saturday market notice writer",
    description:
      "They draft a one-page notice for a neighborhood market and ask a neighbor to read it aloud.",
  },
  {
    id: "original-sales",
    category: "sales",
    title: "Bakery promise writer",
    description:
      "They sit with the person who runs a bakery, hear what the season needs, and write the promise in plain words.",
  },
  {
    id: "original-operations",
    category: "operations",
    title: "Handover gap filler",
    description:
      "When someone is away, they name who covers the counter and leave a short handover note.",
  },
  {
    id: "original-finance",
    category: "finance",
    title: "Supplier bill matcher",
    description:
      "They place each supplier bill next to its purchase note and flag a total that does not add up.",
  },
  {
    id: "original-healthcare",
    category: "healthcare",
    title: "Door and queue guide",
    description: "They point visitors to the right door and say how long the queue looks.",
  },
  {
    id: "original-education",
    category: "education",
    title: "Evening craft practice host",
    description:
      "They host a short practice hour for adults picking up a craft and hand out a one-page exercise.",
  },
  {
    id: "original-customer-support",
    category: "customer_support",
    title: "Late parcel reply writer",
    description:
      "They answer a written question about a late parcel and say what will happen next.",
  },
  {
    id: "original-hr",
    category: "hr",
    title: "First-week welcome host",
    description: "They set out a name card and a buddy for someone joining the bakery.",
  },
];

/**
 * One ordinary-language prototype per category for nearest-prototype scoring.
 * These sentences are not the held-out titles or descriptions.
 */
export const CLASS_PROTOTYPES: Record<JobCorpusCategory, string> = {
  engineering:
    "Keeps a public website available, repairs a broken release, and talks through the change with teammates.",
  data: "Looks at recorded counts and explains which numbers rose and which numbers fell.",
  design: "Chooses layout, color, and pictures so a printed page is easy to look at.",
  product: "Decides which customer request is built this month and which request can wait.",
  marketing: "Prepares a public invitation that asks neighbors to come to a local gathering.",
  sales: "Listens to a buyer, learns what they hope to receive, and writes down the agreement.",
  operations: "Arranges who is working today and leaves a clear note for the following shift.",
  finance: "Compares each invoice with the order and checks that the amounts add up.",
  healthcare: "Shows visitors where to go and explains how their visit will proceed.",
  education: "Guides a practice session and gives learners a short exercise to try on their own.",
  customer_support: "Reads a message about an order problem and explains what happens next.",
  hr: "Gets a desk ready for a new teammate and introduces that person to the group.",
};
