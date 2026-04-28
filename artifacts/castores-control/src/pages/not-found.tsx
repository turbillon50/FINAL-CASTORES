import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 bg-card border-card-border">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-3 items-center">
            <svg className="h-8 w-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h1 className="text-2xl font-bold text-foreground">404 — Página No Encontrada</h1>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            La página que buscas no existe o fue movida.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
