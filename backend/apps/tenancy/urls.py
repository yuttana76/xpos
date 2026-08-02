from django.urls import path

from .views import StoreLookupView

urlpatterns = [
    path("<str:store_code>/", StoreLookupView.as_view(), name="public-store-lookup"),
]
