window.watonUI = function() {
    return {
        authLoading: true,
        authenticated: false,
        authMode: "login",
        authBusy: false,
        authError: "",
        username: "",
        password: "",
        confirmPassword: "",
        showPassword: false,
        whatsappRegistered: false,
        whatsappConnected: false,
        settingsOpen: false,
        pairingMethod: "code",
        pairingBusy: false,
        pairingCode: "",
        pairingQr: "",
        pairingMessage: "",
        phone: "",


        async init() {
            window.WATON_UI = {
                setWhatsAppStatus: (data = {}) => {
                    this.whatsappConnected = Boolean(data.connected);
                    if (this.whatsappConnected) {
                        this.whatsappRegistered = true;
                        this.pairingBusy = false;
                        this.pairingMessage = "";
                    }
                },
                setPairingCode: (code) => {
                    this.pairingCode = String(code || "");
                    this.pairingBusy = false;
                    this.pairingMethod = "code";
                },
                setQrCode: (url) => {
                    this.pairingQr = String(url || "");
                    this.pairingBusy = false;
                    this.pairingMethod = "qr";
                },
                setPairingMessage: (message) => {
                    this.pairingMessage = String(message || "");
                    this.pairingBusy = false;
                }
            };

            try {
                const response = await fetch("/api/auth/me", { credentials: "include" });

                if (!response.ok) return;

                const data = await response.json();

                this.authenticated = Boolean(data.authenticated);
                this.username = data.user?.username || "";
                this.whatsappRegistered = Boolean(data.whatsapp?.registered);

                if (this.authenticated) {
                    this.$nextTick(() => window.startWatonApp?.());
                }
            } catch (error) {
                console.error(error);
            } finally {
                this.authLoading = false;
                this.refreshIcons();
            }
        },


        refreshIcons() {
            this.$nextTick(() => lucide.createIcons());
        },


        switchAuth(mode) {
            this.authMode = mode;
            this.authError = "";
            this.password = "";
            this.confirmPassword = "";
            this.refreshIcons();
        },


        async submitAuth() {
            if (this.authBusy) return;
            this.authError = "";

            if (!this.username.trim() || !this.password) {
                this.authError = "Username dan password wajib diisi";
                return;
            }

            if (this.authMode === "register" && this.password !== this.confirmPassword) {
                this.authError = "Konfirmasi password tidak sama";
                return;
            }

            this.authBusy = true;

            try {
                const endpoint = this.authMode === "login"
                    ? "/api/auth/login"
                    : "/api/auth/register";

                const response = await fetch(endpoint, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        username: this.username.trim(),
                        password: this.password,
                        confirmPassword: this.confirmPassword
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.message || "Authentication failed");
                }

                this.username = data.user?.username || this.username.trim();
                this.authenticated = true;
                this.password = "";
                this.confirmPassword = "";
                this.whatsappRegistered = Boolean(data.whatsapp?.registered);

                this.$nextTick(() => {
                    window.startWatonApp?.();
                    lucide.createIcons();
                });
            } catch (error) {
                this.authError = error.message || "Authentication failed";
            } finally {
                this.authBusy = false;
            }
        },


        async logout() {
            await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "include"
            }).catch(() => {});

            window.stopWatonApp?.();

            this.authenticated = false;
            this.whatsappConnected = false;
            this.whatsappRegistered = false;
            this.settingsOpen = false;
            this.password = "";
            this.confirmPassword = "";
            this.pairingCode = "";
            this.pairingQr = "";
            this.phone = "";
            this.authMode = "login";
            this.refreshIcons();
        },


        startWhatsApp(method) {
            this.pairingMessage = "";
            this.pairingCode = "";
            this.pairingQr = "";
            this.pairingMethod = method;

            if ((method === "code" || method === "pairing") && !this.phone.trim()) {
                this.pairingMessage = "Masukkan nomor WhatsApp terlebih dahulu";
                return;
            }

            this.pairingBusy = true;

            window.dispatchEvent(new CustomEvent("waton:wa-auth-start", {
                detail: {
                    method,
                    phone: this.phone.trim()
                }
            }));
        }
    };
};