import { FormicLogo, FormicMark } from "@/components/formic-logo";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="lg:w-1/2 bg-[#091517] flex flex-col justify-between p-8 lg:p-12">
        <div className="flex items-center gap-3">
          <FormicMark className="h-8 text-[#FF9100]" />
          <div className="w-px h-6 bg-white/20"></div>
          <span className="font-semibold text-sm tracking-wide text-white/90 uppercase">ISR Tracker</span>
        </div>

        <div className="my-12 lg:my-0">
          <h1 className="text-4xl lg:text-5xl font-bold text-[#F0F5F1] tracking-tight leading-tight">
            Internal Service
            <br />
            <span className="text-[#FF9100]">Request Tracker</span>
          </h1>
          <p className="text-[#9BA19E] mt-4 text-lg max-w-md">
            Monitor, manage, and resolve internal service requests across your organization.
          </p>
        </div>

        <div className="text-[#9BA19E]/60 text-sm">
          <FormicLogo className="h-5 text-[#F0F5F1]/30 mb-3" />
          <span>Formic Technologies, Inc.</span>
        </div>
      </div>

      <div className="lg:w-1/2 flex items-center justify-center p-8 lg:p-12 bg-background">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#FF9100]/10 mb-6">
            <FormicMark className="h-7 text-[#FF9100]" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">Welcome</h2>
          <p className="text-muted-foreground mb-8">
            Sign in with your Formic account to access the tracker.
          </p>
          <Button
            data-testid="button-login"
            asChild
            size="lg"
            className="w-full bg-[#FF9100] text-white text-base font-medium shadow-lg shadow-[#FF9100]/20"
          >
            <a href="/api/login">
              <LogIn className="h-5 w-5 mr-2" />
              Sign in with Formic
            </a>
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            Restricted to @formic.co accounts
          </p>
        </div>
      </div>
    </div>
  );
}
