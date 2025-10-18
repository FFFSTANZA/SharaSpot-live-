export declare class OwnerWebhookController {
    private ownerContexts;
    private readonly CONTEXT_TIMEOUT;
    enterOwnerMode(whatsappId: string): Promise<void>;
    handleOwnerMessage(whatsappId: string, messageType: string, content: any): Promise<void>;
    private handleOwnerText;
    private handleOwnerButton;
    private showOwnerAuthentication;
    private handleOwnerRegistration;
    private handleOwnerLogin;
    private showOwnerMainMenu;
    private showStationManagement;
    private showOwnerProfile;
    private showOwnerAnalytics;
    private showOwnerSettings;
    private showOwnerHelp;
    private handleOwnerList;
    isInOwnerMode(whatsappId: string): boolean;
    private exitOwnerMode;
    private sendOwnerError;
    private getOwnerContext;
    private createOwnerContext;
    private updateContext;
    cleanupExpiredContexts(): void;
    getActiveContextsCount(): number;
}
export declare const ownerWebhookController: OwnerWebhookController;
//# sourceMappingURL=owner-webhook.d.ts.map