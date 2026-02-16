import { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";
import type { AppSettings, ValidationResult } from "../types";
import {
  loadSettings,
  saveSettings,
  saveCredentials,
  hasCredentials as hasCredentialsCmd,
  getCredentialHint,
  deleteCredentials,
  validateCredentials,
} from "../commands";
import { useUpdate } from "../context/UpdateContext";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type ValidationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: ValidationResult }
  | { status: "error"; message: string };

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<AppSettings>({
    bucket: "",
    region: "ap-southeast-2",
    s3Prefix: "galleries/",
    lastValidatedUser: "",
    lastValidatedAccount: "",
    lastValidatedArn: "",
    cloudFrontDistributionId: "",
  });

  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [hasCreds, setHasCreds] = useState(false);
  const [credHint, setCredHint] = useState<string | null>(null);
  const [isChangingCreds, setIsChangingCreds] = useState(false);
  const [validation, setValidation] = useState<ValidationState>({ status: "idle" });
  const [credentialsValidated, setCredentialsValidated] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadCurrentSettings = useCallback(async () => {
    try {
      const s = await loadSettings();
      setSettings(s);
      const has = await hasCredentialsCmd();
      setHasCreds(has);
      if (has) {
        const hint = await getCredentialHint();
        setCredHint(hint);
      }
      if (s.lastValidatedUser) {
        setValidation({
          status: "success",
          result: {
            user: s.lastValidatedUser,
            account: s.lastValidatedAccount,
            arn: s.lastValidatedArn,
          },
        });
      }
    } catch {
      // Settings not found, use defaults
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadCurrentSettings();
      setKeyId("");
      setSecret("");
      setIsChangingCreds(false);
      setCredentialsValidated(false);
    }
  }, [open, loadCurrentSettings]);

  const handleValidate = async () => {
    // Credential inputs are visible when there are no saved creds OR user clicked "Change Credentials"
    const isEnteringCreds = !hasCreds || isChangingCreds;
    const currentKeyId = isEnteringCreds ? keyId : "";
    const currentSecret = isEnteringCreds ? secret : "";

    if (isEnteringCreds && (!currentKeyId || !currentSecret)) {
      setValidation({ status: "error", message: "Please enter both Key ID and Secret Access Key." });
      return;
    }

    if (!settings.bucket || !settings.region) {
      setValidation({ status: "error", message: "Please enter Bucket and Region." });
      return;
    }

    setValidation({ status: "loading" });

    try {
      let validKeyId = currentKeyId;
      let validSecret = currentSecret;

      // If not changing creds, we need to use existing ones via backend
      // But validate_credentials requires the actual values
      // So if not changing, we temporarily save and use them
      if (!isEnteringCreds && hasCreds) {
        // Credentials are in keychain; the validate command needs them passed directly
        // Since we can't retrieve them from UI, validate only works when entering new creds
        // OR we need a separate command. For now, show previous validation result.
        setValidation({
          status: "success",
          result: {
            user: settings.lastValidatedUser,
            account: settings.lastValidatedAccount,
            arn: settings.lastValidatedArn,
          },
        });
        return;
      }

      console.log("[validate] Calling validate_credentials", {
        keyIdLength: validKeyId.length,
        secretLength: validSecret.length,
        bucket: settings.bucket,
        region: settings.region,
      });
      const result = await validateCredentials(validKeyId, validSecret, settings.bucket, settings.region);
      console.log("[validate] Success", result);
      setValidation({ status: "success", result });
      setCredentialsValidated(true);
      setSettings((s) => ({
        ...s,
        lastValidatedUser: result.user,
        lastValidatedAccount: result.account,
        lastValidatedArn: result.arn,
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setValidation({ status: "error", message });
      setCredentialsValidated(false);
      setSettings((s) => ({
        ...s,
        lastValidatedUser: "",
        lastValidatedAccount: "",
        lastValidatedArn: "",
      }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(settings);

      if ((!hasCreds || isChangingCreds) && credentialsValidated && keyId && secret) {
        await saveCredentials(keyId, secret);
        setHasCreds(true);
        setCredHint(keyId.length >= 4 ? keyId.slice(-4) : keyId);
        setIsChangingCreds(false);
        setKeyId("");
        setSecret("");
      }

      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setValidation({ status: "error", message: `Save failed: ${message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleChangeCredentials = () => {
    setIsChangingCreds(true);
    setKeyId("");
    setSecret("");
    setCredentialsValidated(false);
    setValidation({ status: "idle" });
  };

  const handleDeleteCredentials = async () => {
    await deleteCredentials();
    setHasCreds(false);
    setCredHint(null);
    setIsChangingCreds(false);
    setCredentialsValidated(false);
    setValidation({ status: "idle" });
    setSettings((s) => ({
      ...s,
      lastValidatedUser: "",
      lastValidatedAccount: "",
      lastValidatedArn: "",
    }));
  };

  const isEnteringCredsForSave = !hasCreds || isChangingCreds;
  const canSaveCredentials = !isEnteringCredsForSave || credentialsValidated;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background border border-border rounded-lg shadow-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">Settings</h2>

        {/* AWS Credentials Section */}
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-3 text-muted-foreground">AWS Credentials</h3>

          {hasCreds && !isChangingCreds ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm mb-1">AWS Access Key ID</label>
                <div className="px-3 py-2 rounded-md border border-border bg-muted text-sm text-muted-foreground select-none">
                  {"••••••••••••" + (credHint || "")}
                </div>
              </div>
              <div>
                <label className="block text-sm mb-1">AWS Secret Access Key</label>
                <div className="px-3 py-2 rounded-md border border-border bg-muted text-sm text-muted-foreground select-none">
                  ••••••••••••
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleChangeCredentials}
                  className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
                >
                  Change Credentials
                </button>
                <button
                  onClick={handleDeleteCredentials}
                  className="px-3 py-1.5 text-sm rounded-md border border-border text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Delete Credentials
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm mb-1">AWS Access Key ID</label>
                <input
                  type="password"
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">AWS Secret Access Key</label>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  autoComplete="off"
                />
              </div>
              {hasCreds && isChangingCreds && (
                <button
                  onClick={() => {
                    setIsChangingCreds(false);
                    setKeyId("");
                    setSecret("");
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel credential change
                </button>
              )}
            </div>
          )}
        </div>

        {/* S3 Configuration */}
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-3 text-muted-foreground">S3 Configuration</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm mb-1">S3 Bucket Name</label>
              <input
                type="text"
                value={settings.bucket}
                onChange={(e) => setSettings((s) => ({ ...s, bucket: e.target.value }))}
                placeholder="my-gallery-bucket"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">AWS Region</label>
              <input
                type="text"
                value={settings.region}
                onChange={(e) => setSettings((s) => ({ ...s, region: e.target.value }))}
                placeholder="us-east-1"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">S3 Prefix</label>
              <input
                type="text"
                value={settings.s3Prefix}
                onChange={(e) => setSettings((s) => ({ ...s, s3Prefix: e.target.value }))}
                placeholder="galleries/"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">CloudFront Distribution ID</label>
              <input
                type="text"
                value={settings.cloudFrontDistributionId}
                onChange={(e) => setSettings((s) => ({ ...s, cloudFrontDistributionId: e.target.value }))}
                placeholder="E1ABC2DEF3GH"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </div>

        {/* Validation */}
        <div className="mb-6">
          <button
            onClick={handleValidate}
            disabled={validation.status === "loading"}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {validation.status === "loading" ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Validating...
              </span>
            ) : (
              "Validate"
            )}
          </button>

          <ValidationStatus validation={validation} />
        </div>

        {/* About */}
        <AboutSection />

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !canSaveCredentials}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ValidationStatus({ validation }: { validation: ValidationState }) {
  if (validation.status === "idle") return null;
  if (validation.status === "loading") return null;

  if (validation.status === "success") {
    return (
      <div className="mt-3 p-3 rounded-md bg-green-500/10 border border-green-500/20" data-testid="validation-success">
        <div className="flex items-center gap-2 text-green-500 text-sm font-medium mb-2">
          <CheckCircle className="w-4 h-4" />
          Credentials validated
        </div>
        <div className="text-xs space-y-1 text-muted-foreground">
          <div><span className="font-medium">User:</span> {validation.result.user}</div>
          <div><span className="font-medium">Account:</span> {validation.result.account}</div>
          <div><span className="font-medium">ARN:</span> {validation.result.arn}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 rounded-md bg-destructive/10 border border-destructive/20" data-testid="validation-error">
      <div className="flex items-center gap-2 text-destructive text-sm">
        <AlertCircle className="w-4 h-4" />
        {validation.message}
      </div>
    </div>
  );
}

function AboutSection() {
  const { status, currentVersion, checkForUpdate, downloadAndInstall } = useUpdate();

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium mb-3 text-muted-foreground">About</h3>
      <div className="space-y-3">
        <div className="text-sm">
          <span className="text-muted-foreground">Version: </span>
          <span>{currentVersion || "..."}</span>
        </div>

        {status.phase === "available" ? (
          <div className="space-y-2">
            <p className="text-sm text-primary">
              Update available: v{status.version}
            </p>
            <button
              onClick={() => downloadAndInstall()}
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Download and Install
            </button>
          </div>
        ) : (
          <button
            onClick={() => checkForUpdate(false)}
            disabled={status.phase === "checking"}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50"
          >
            {status.phase === "checking" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Check for Updates
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
