namespace Valour.Client.Soundboard;

/// <summary>
/// Open state for the soundboard panel. The panel is rendered by the chat input
/// component and toggled from the composer button beside the emoji picker.
/// </summary>
public class SoundboardState
{
    public bool IsOpen { get; private set; }

    public event Action? Changed;

    public void Toggle()
    {
        IsOpen = !IsOpen;
        Changed?.Invoke();
    }

    public void Close()
    {
        if (!IsOpen)
            return;

        IsOpen = false;
        Changed?.Invoke();
    }
}
