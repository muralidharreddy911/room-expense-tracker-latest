import { useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Check, X, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useApp } from "@/hooks/use-app-store";
import { CleaningAttendance } from "@/lib/types";

export function AttendanceApproval() {
  const { cleaningAttendance, users, currentUser, updateCleaningAttendanceStatus, availableMonths } = useApp();
  const [selectedMonth, setSelectedMonth] = useState<string>(
    availableMonths.length > 0 ? availableMonths[0] : format(new Date(), "yyyy-MM")
  );
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Filter pending records only
  const pendingRecords = useMemo(() => {
    return cleaningAttendance
      .filter(a => a.month === selectedMonth && a.status === "pending_approval")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [cleaningAttendance, selectedMonth]);

  const handleApprove = async (recordId: string) => {
    if (!currentUser) return;
    setProcessingId(recordId);
    try {
      await updateCleaningAttendanceStatus(recordId, "approved", currentUser.id);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (recordId: string) => {
    if (!currentUser) return;
    setProcessingId(recordId);
    try {
      await updateCleaningAttendanceStatus(recordId, "rejected", currentUser.id);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Month Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Month Selection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label className="text-sm font-medium mb-2 block">Month</Label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableMonths.map(month => (
                  <SelectItem key={month} value={month}>
                    {format(parseISO(`${month}-01`), "MMMM yyyy")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Pending Approvals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Pending Approvals ({pendingRecords.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No pending approvals for {format(parseISO(`${selectedMonth}-01`), "MMMM yyyy")}
            </div>
          ) : (
            <div className="space-y-4">
              {pendingRecords.map(record => {
                const user = users.find(u => u.id === record.userId);
                const isProcessing = processingId === record.id;

                return (
                  <div
                    key={record.id}
                    className="border rounded-lg p-4 bg-card hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3">
                          <Avatar className="h-10 w-10 flex-shrink-0">
                            <AvatarImage src={user?.avatar} />
                            <AvatarFallback>{user?.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm">{user?.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(parseISO(record.date), "dd MMM yyyy")}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2 ml-13">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Cleaning Type:</span>
                            <Badge variant="outline">
                              {record.cleaningType === "room_cleaning"
                                ? "Room Cleaning"
                                : "Vessel Cleaning"}
                            </Badge>
                          </div>

                          {record.remarks && (
                            <div>
                              <span className="text-sm text-muted-foreground">Remarks:</span>
                              <p className="text-sm mt-1 bg-secondary/50 rounded p-2">
                                {record.remarks}
                              </p>
                            </div>
                          )}

                          <div className="text-xs text-muted-foreground pt-2">
                            Submitted: {format(parseISO(record.createdAt), "dd MMM yyyy, hh:mm a")}
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2 flex-shrink-0">
                        {/* Approve Dialog */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                              disabled={isProcessing}
                            >
                              {isProcessing ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Approve Attendance?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Approve {user?.name}'s {record.cleaningType === "room_cleaning" ? "Room" : "Vessel"} Cleaning attendance for {format(parseISO(record.date), "dd MMM yyyy")}?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleApprove(record.id)}>
                                Approve
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        {/* Reject Dialog */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                              disabled={isProcessing}
                            >
                              {isProcessing ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <X className="h-4 w-4" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reject Attendance?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Reject {user?.name}'s {record.cleaningType === "room_cleaning" ? "Room" : "Vessel"} Cleaning attendance for {format(parseISO(record.date), "dd MMM yyyy")}?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleReject(record.id)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                Reject
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
