from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.decorators import require_role
from api.importers.service import import_workload_excel


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
@require_role('SCHOOL_OPS')
def import_excel(request):
    """
    POST /api/ops/import/
    Upload the Workload Import Template Excel file.
    The file must have Semester in B1, Academic Year in C1, Department in D1.
    Returns: { batch_id, created, updated, skipped, errors }
    """
    file_obj = request.FILES.get('file')
    if not file_obj:
        return Response(
            {"code": "VALIDATION_ERROR", "message": "No file uploaded. Use field name 'file'."},
            status=400,
        )

    if not file_obj.name.endswith(('.xlsx', '.xlsm')):
        return Response(
            {"code": "VALIDATION_ERROR", "message": "Only .xlsx or .xlsm files are accepted."},
            status=400,
        )

    try:
        result = import_workload_excel(file_obj, uploaded_by=request.staff)
    except ValueError as e:
        return Response({"code": "VALIDATION_ERROR", "message": str(e)}, status=400)

    return Response(result, status=201)
