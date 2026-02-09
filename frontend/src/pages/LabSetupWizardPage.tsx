import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConical, ArrowRight, ArrowLeft, Check } from "lucide-react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import ToggleSwitch from "../components/ToggleSwitch";

const DEFAULT_EXPIRY_DAYS = 30;

interface StepConfig {
  title: string;
  description: string;
  key: string;
}

const STEPS: StepConfig[] = [
  {
    title: "Inventory Tracking Mode",
    description:
      "By default, LabAid tracks the full vial lifecycle: sealed, opened, and depleted. If your lab only needs to count sealed vials in stock, enable this to simplify the workflow.",
    key: "sealed_counts_only",
  },
  {
    title: "QC Document Requirement",
    description:
      "When enabled, every new lot must have a QC document uploaded before it can be approved for use. This helps ensure quality control compliance and provides an audit trail.",
    key: "qc_doc_required",
  },
  {
    title: "Storage Tracking",
    description:
      "Track where your reagents are physically stored using visual grid layouts. You can map freezers, refrigerators, and racks with row/column grids. Disable this if your lab doesn't need location tracking.",
    key: "storage_enabled",
  },
  {
    title: "Expiry Warning",
    description:
      "Set how many days before a lot's expiration date it should be flagged as \"expiring soon\" on the dashboard. This gives your team advance notice to plan reorders.",
    key: "expiry_warn_days",
  },
];

export default function LabSetupWizardPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    sealed_counts_only: false,
    qc_doc_required: false,
    storage_enabled: true,
    expiry_warn_days: DEFAULT_EXPIRY_DAYS,
  });

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleFinish = async () => {
    setSaving(true);
    try {
      await api.patch(`/labs/${user!.lab_id}/settings`, {
        ...settings,
        setup_complete: true,
      });
      await refreshUser();
      navigate("/");
    } catch {
      // Still navigate — settings are best-effort
      navigate("/");
    }
  };

  const handleNext = () => {
    if (isLast) {
      handleFinish();
    } else {
      setStep(step + 1);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await api.patch(`/labs/${user!.lab_id}/settings`, { setup_complete: true });
      await refreshUser();
    } catch { /* ignore */ }
    navigate("/");
  };

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />
      <div className="login-orb login-orb-3" aria-hidden="true" />

      <div className="login-card" style={{ maxWidth: 480 }}>
        <div className="login-brand">
          <div className="login-icon">
            <FlaskConical size={26} />
          </div>
          <div>
            <h1>Lab Setup</h1>
            <p className="subtitle">Configure your lab preferences</p>
          </div>
        </div>

        {/* Step indicators */}
        <div className="setup-steps">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`setup-step-dot${i === step ? " active" : ""}${i < step ? " done" : ""}`}
            />
          ))}
        </div>

        <div className="wizard-step">
          <h2 className="wizard-step-title">{current.title}</h2>
          <p className="wizard-step-desc">{current.description}</p>

          <div className="wizard-control">
            {current.key === "expiry_warn_days" ? (
              <div className="wizard-number-row">
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="stability-input"
                  value={settings.expiry_warn_days}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (Number.isFinite(val) && val >= 1) {
                      setSettings({ ...settings, expiry_warn_days: val });
                    }
                  }}
                />
                <span className="wizard-number-label">days before expiration</span>
              </div>
            ) : (
              <div className="wizard-toggle-row">
                <ToggleSwitch
                  checked={settings[current.key as keyof typeof settings] as boolean}
                  onChange={() =>
                    setSettings({
                      ...settings,
                      [current.key]: !settings[current.key as keyof typeof settings],
                    })
                  }
                />
                <span className="wizard-toggle-label">
                  {settings[current.key as keyof typeof settings] ? "Enabled" : "Disabled"}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="wizard-nav">
          {step > 0 ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={16} /> Back
            </button>
          ) : (
            <button type="button" className="btn-link" onClick={handleSkip}>
              Skip setup
            </button>
          )}
          <button
            type="button"
            className="login-submit"
            onClick={handleNext}
            disabled={saving}
            style={{ width: "auto", flex: "none", padding: "0.6rem 1.5rem" }}
          >
            {isLast ? (
              <>
                <Check size={16} style={{ marginRight: 4, verticalAlign: -3 }} />
                {saving ? "Saving..." : "Finish"}
              </>
            ) : (
              <>
                Next <ArrowRight size={16} style={{ marginLeft: 4, verticalAlign: -3 }} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
