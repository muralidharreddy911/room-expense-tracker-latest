import { useState } from "react";
import { useApp } from "@/hooks/use-app-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCw } from "lucide-react";
import { AttendanceForm } from "@/components/attendance-form";
import { AttendanceList } from "@/components/attendance-list";
import { AttendanceApproval } from "@/components/attendance-approval";
import { AttendanceSummary } from "@/components/attendance-summary";

export default function CleaningAttendancePage() {
  const { currentUser, refreshState } = useApp();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshState();
    } finally {
      setIsRefreshing(false);
    }
  };

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cleaning Attendance</h1>
          <p className="text-muted-foreground mt-1">
            Track and manage room and vessel cleaning activities
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
          <AttendanceForm>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Submit Attendance
            </Button>
          </AttendanceForm>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="history" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="history">History</TabsTrigger>
          {isAdmin && <TabsTrigger value="approval">Approvals</TabsTrigger>}
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          <AttendanceList />
        </TabsContent>

        {/* Approval Tab (Admin Only) */}
        {isAdmin && (
          <TabsContent value="approval" className="space-y-4">
            <AttendanceApproval />
          </TabsContent>
        )}

        {/* Summary Tab */}
        <TabsContent value="summary" className="space-y-4">
          <AttendanceSummary />
        </TabsContent>
      </Tabs>
    </div>
  );
}
