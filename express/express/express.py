import reflex as rx


class LandingState(rx.State):
    """Public landing-page state. Ordering flows will be added next."""


def index() -> rx.Component:
    return rx.container(
        rx.vstack(
            rx.heading("ChowOnCampus Express", size="8"),
            rx.text("Order from participating campus businesses. Get it delivered anywhere on campus."),
            rx.text("Gate delivery: ₦300  •  Room delivery: ₦400"),
            rx.text(
                "This is the initial project scaffold. The student catalogue, order flow, "
                "agent dispatch, and admin control centre are being built next."
            ),
            spacing="4",
            align="start",
            width="100%",
        ),
        max_width="48rem",
        padding="2rem",
    )


app = rx.App()
app.add_page(index, route="/", title="ChowOnCampus Express")
