import openpyxl
from rest_framework.decorators import api_view
from rest_framework.response import Response

from api.decorators import require_role
from api.models import Staff
from api.services.importer_service import import_workload_excel


@api_view(['POST'])
@require_role('SCHOOL_OPS')
def import_workload_view(request):
    """
    Upload and import the unified workload Excel template.

    Only SCHOOL_OPS (Daniela) can call this endpoint.

    Request: multipart/form-data
      - file (xlsx): the completed workload template

    Response 200:
      {
        "created": int,
        "updated": int,
        "skipped": int,
        "errors": [{"row": int, "message": str}]
      }

    Response 400:
      - {"error": "No file uploaded."}
      - {"error": "File must be an .xlsx file."}
    """
    uploaded = request.FILES.get('file')
    if not uploaded:
        return Response({"error": "No file uploaded."}, status=400)

    if not uploaded.name.endswith('.xlsx'):
        return Response({"error": "File must be an .xlsx file."}, status=400)

    try:
        wb = openpyxl.load_workbook(uploaded, read_only=True, data_only=True)
    except Exception as exc:
        return Response({"error": f"Cannot read file: {exc}"}, status=400)

    importing_staff = Staff.objects.get(user=request.user)
    summary = import_workload_excel(wb, importing_staff)

    status_code = 200 if not summary["errors"] else 207
    return Response(summary, status=status_code)
