import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-xl group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-signal/20 group-[.toaster]:shadow-lift group-[.toaster]:font-sans",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-signal group-[.toast]:text-signal-foreground",
          cancelButton: "group-[.toast]:bg-signal-soft group-[.toast]:text-signal",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
