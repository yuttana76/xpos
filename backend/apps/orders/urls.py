from django.urls import path

from .reports_views import (
    DailySalesByStaffReportView,
    DailySalesReportView,
    DiscountReportView,
    MenuPerformanceReportView,
    SalesByHourReportView,
    SalesByStaffReportView,
    SalesReportView,
    TaxReportView,
    VoidReportView,
)
from .views import (
    OpenOrdersView,
    OpenTableView,
    OpenTakeawayView,
    OrderCancelView,
    OrderDetailView,
    OrderDiscountView,
    OrderItemKitchenStatusView,
    OrderItemServeView,
    OrderItemsSendToKitchenView,
    OrderItemsView,
    OrderPayView,
    OrderSummaryView,
    OrderTodaySalesView,
)

urlpatterns = [
    path("open-table/", OpenTableView.as_view(), name="order-open-table"),
    path("takeaway/", OpenTakeawayView.as_view(), name="order-open-takeaway"),
    path("open/", OpenOrdersView.as_view(), name="order-open-list"),
    path("summary/", OrderSummaryView.as_view(), name="order-summary"),
    path("today-sales/", OrderTodaySalesView.as_view(), name="order-today-sales"),
    path("reports/sales/", SalesReportView.as_view(), name="report-sales"),
    path("reports/daily-sales/", DailySalesReportView.as_view(), name="report-daily-sales"),
    path("reports/menu-performance/", MenuPerformanceReportView.as_view(), name="report-menu-performance"),
    path("reports/sales-by-hour/", SalesByHourReportView.as_view(), name="report-sales-by-hour"),
    path("reports/sales-by-staff/", SalesByStaffReportView.as_view(), name="report-sales-by-staff"),
    path(
        "reports/daily-sales-by-staff/",
        DailySalesByStaffReportView.as_view(),
        name="report-daily-sales-by-staff",
    ),
    path("reports/discounts/", DiscountReportView.as_view(), name="report-discounts"),
    path("reports/voids/", VoidReportView.as_view(), name="report-voids"),
    path("reports/tax/", TaxReportView.as_view(), name="report-tax"),
    path("<uuid:order_id>/", OrderDetailView.as_view(), name="order-detail"),
    path("<uuid:order_id>/items/", OrderItemsView.as_view(), name="order-items"),
    path(
        "<uuid:order_id>/items/send-to-kitchen/",
        OrderItemsSendToKitchenView.as_view(),
        name="order-items-send-to-kitchen",
    ),
    path(
        "<uuid:order_id>/items/<uuid:item_id>/",
        OrderItemsView.as_view(),
        name="order-item-detail",
    ),
    path(
        "<uuid:order_id>/items/<uuid:item_id>/serve/",
        OrderItemServeView.as_view(),
        name="order-item-serve",
    ),
    path(
        "<uuid:order_id>/items/<uuid:item_id>/kitchen-status/",
        OrderItemKitchenStatusView.as_view(),
        name="order-item-kitchen-status",
    ),
    path("<uuid:order_id>/discount/", OrderDiscountView.as_view(), name="order-discount"),
    path("<uuid:order_id>/cancel/", OrderCancelView.as_view(), name="order-cancel"),
    path("<uuid:order_id>/pay/", OrderPayView.as_view(), name="order-pay"),
]
